/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/openrouter/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { OPENROUTER_RUN_FNS } = _testOnly;

function findRunFn(servesKey: string) {
  const reg = OPENROUTER_RUN_FNS.find((r) => [...r.serves].sort().join(",") === servesKey);
  if (!reg) throw new Error(`no OpenRouter run-fn registered for ${servesKey}`);
  return reg.runFn;
}

const structuredGenFn = findRunFn("json-mode,text.generation");
const textRewriterFn = findRunFn("text.rewriter");
const textSummaryFn = findRunFn("text.summary");

/**
 * SSE-encoded fake upstream: one `data: {json}` line per chunk, blank-line
 * separated, `[DONE]` terminator — the wire format the openai SDK's stream
 * parser expects. Passes the chunk objects verbatim so we can inject the
 * unguarded shapes (`{}`, `{choices: []}`, `{choices: [{}]}`) alongside
 * content frames.
 */
function sseResponse(chunks: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const model = {
  model_id: "openrouter-x",
  provider_config: { model_name: "anthropic/claude-sonnet-4", api_key: "test-key" },
} as any;

const strictObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["a"],
  properties: { a: { type: "number" } },
} as const;

// OpenRouter multiplexes upstream provider frames; keepalives and provider
// switchovers routinely arrive without a `choices` field. Each case exercises
// one of the unsafe access shapes we replaced with `chunk.choices?.[0]?.…`.
const unsafeShapes = [
  { label: "choices field absent", pre: [{}] },
  { label: "empty choices array", pre: [{ choices: [] }] },
  { label: "choices[0] with no delta", pre: [{ choices: [{}] }] },
];

describe("OpenRouter streaming run-fns tolerate SDK chunks without choices/delta", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("OpenRouter_StructuredGeneration_Stream", () => {
    for (const { label, pre } of unsafeShapes) {
      it(`skips ${label} and completes with the assembled object`, async () => {
        fetchSpy.mockResolvedValueOnce(
          sseResponse([
            ...pre,
            { choices: [{ delta: { content: '{"a":' } }] },
            { choices: [{ delta: { content: "1}" } }] },
          ])
        );

        const events: any[] = [];
        await expect(
          structuredGenFn(
            { prompt: "hi", outputSchema: strictObjectSchema } as any,
            model,
            new AbortController().signal,
            (e) => events.push(e)
          )
        ).resolves.toBeUndefined();

        const finish = events.at(-1);
        expect(finish?.type).toBe("finish");
        expect(finish?.data?.object).toEqual({ a: 1 });
      });
    }
  });

  describe("OpenRouter_TextRewriter_Stream", () => {
    for (const { label, pre } of unsafeShapes) {
      it(`skips ${label} and emits the text-delta from later chunks`, async () => {
        fetchSpy.mockResolvedValueOnce(
          sseResponse([...pre, { choices: [{ delta: { content: "hello" } }] }])
        );

        const events: any[] = [];
        await expect(
          textRewriterFn(
            { prompt: "rewrite", text: "input" } as any,
            model,
            new AbortController().signal,
            (e) => events.push(e)
          )
        ).resolves.toBeUndefined();

        const textDeltas = events.filter((e) => e.type === "text-delta");
        expect(textDeltas.map((d) => d.textDelta).join("")).toBe("hello");
      });
    }
  });

  describe("OpenRouter_TextSummary_Stream", () => {
    for (const { label, pre } of unsafeShapes) {
      it(`skips ${label} and emits the text-delta from later chunks`, async () => {
        fetchSpy.mockResolvedValueOnce(
          sseResponse([...pre, { choices: [{ delta: { content: " world" } }] }])
        );

        const events: any[] = [];
        await expect(
          textSummaryFn({ text: "input" } as any, model, new AbortController().signal, (e) =>
            events.push(e)
          )
        ).resolves.toBeUndefined();

        const textDeltas = events.filter((e) => e.type === "text-delta");
        expect(textDeltas.map((d) => d.textDelta).join("")).toBe(" world");
      });
    }
  });

  // Turning on `include_usage` is what appends the terminal `choices: []` frame
  // these suites guard against, so the usage assertions belong right here.
  describe("usage from the terminal include_usage frame", () => {
    const requestBody = (): Record<string, unknown> =>
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));

    it("asks for usage and carries OpenRouter's cost through extra", async () => {
      fetchSpy.mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { content: "hi" } }] },
          {
            choices: [],
            usage: {
              prompt_tokens: 44,
              completion_tokens: 12,
              total_tokens: 56,
              cost: 0.00031,
            },
          },
        ])
      );

      const events: any[] = [];
      await textSummaryFn({ text: "input" } as any, model, new AbortController().signal, (e) =>
        events.push(e)
      );

      expect(requestBody().stream_options).toEqual({ include_usage: true });
      expect(events.at(-1).usage).toEqual({
        input: 44,
        output: 12,
        cached: undefined,
        cacheWrite: undefined,
        reasoning: undefined,
        total: 56,
        extra: { cost: 0.00031 },
      });
    });

    it("leaves usage absent when the stream never reports it", async () => {
      fetchSpy.mockResolvedValueOnce(sseResponse([{ choices: [{ delta: { content: "hi" } }] }]));

      const events: any[] = [];
      await textSummaryFn({ text: "input" } as any, model, new AbortController().signal, (e) =>
        events.push(e)
      );

      expect(events.at(-1).usage).toBeUndefined();
    });

    it("still assembles the object when a usage frame trails a structured stream", async () => {
      fetchSpy.mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { content: '{"a":' } }] },
          { choices: [{ delta: { content: "1}" } }] },
          { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } },
        ])
      );

      const events: any[] = [];
      await structuredGenFn(
        { prompt: "hi", outputSchema: strictObjectSchema } as any,
        model,
        new AbortController().signal,
        (e) => events.push(e)
      );

      const finish = events.at(-1);
      expect(finish.data.object).toEqual({ a: 1 });
      expect(finish.usage.input).toBe(3);
      expect(finish.usage.cached).toBeUndefined();
    });
  });
});
