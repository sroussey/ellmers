/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/xai/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { XAI_RUN_FNS } = _testOnly;

function findRunFn(servesKey: string) {
  const reg = XAI_RUN_FNS.find((r) => [...r.serves].sort().join(",") === servesKey);
  if (!reg) throw new Error(`no xAI run-fn registered for ${servesKey}`);
  return reg.runFn;
}

const structuredGenFn = findRunFn("json-mode,text.generation");
const textRewriterFn = findRunFn("text.rewriter");
const textSummaryFn = findRunFn("text.summary");

/**
 * Encode a list of streaming chunk objects into the OpenAI-compatible SSE wire
 * format that the openai SDK's stream parser consumes: one `data: {json}` per
 * event, blank line separator, `data: [DONE]` terminator. The chunks array is
 * passed verbatim so we can inject the unguarded shapes (`{}`, `{choices: []}`,
 * `{choices: [{}]}`) alongside real content frames.
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
  model_id: "grok-x",
  provider_config: { model_name: "grok-3-mini", api_key: "test-key" },
} as any;

const strictObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["a"],
  properties: { a: { type: "number" } },
} as const;

// The three unsafe SDK chunk shapes we replaced with `chunk.choices?.[0]?.…`:
//   - `choices` field absent (SSE keepalive / multiplexed upstream frame)
//   - `choices` is an empty array
//   - `choices[0]` exists but has no `delta` (initial role frame)
const unsafeShapes = [
  { label: "choices field absent", pre: [{}] },
  { label: "empty choices array", pre: [{ choices: [] }] },
  { label: "choices[0] with no delta", pre: [{ choices: [{}] }] },
];

describe("xAI streaming run-fns tolerate SDK chunks without choices/delta", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("Xai_StructuredGeneration_Stream", () => {
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

  describe("Xai_TextRewriter_Stream", () => {
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

  describe("Xai_TextSummary_Stream", () => {
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

    it("asks for usage and maps the terminal frame onto finish", async () => {
      fetchSpy.mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { content: "hi" } }] },
          {
            choices: [],
            usage: {
              prompt_tokens: 31,
              completion_tokens: 7,
              total_tokens: 38,
              prompt_tokens_details: { cached_tokens: 12 },
              completion_tokens_details: { reasoning_tokens: 4 },
            },
          },
        ])
      );

      const events: any[] = [];
      await textSummaryFn({ text: "input" } as any, model, new AbortController().signal, (e) =>
        events.push(e)
      );

      expect(requestBody().stream_options).toEqual({ include_usage: true });
      const finish = events.at(-1);
      expect(finish.type).toBe("finish");
      expect(finish.usage).toEqual({
        input: 19,
        output: 7,
        cached: 12,
        cacheWrite: undefined,
        reasoning: 4,
        total: 38,
        extra: undefined,
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

    it("reports xAI's unreported cacheWrite as undefined, not 0", async () => {
      fetchSpy.mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { content: "hi" } }] },
          { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
        ])
      );

      const events: any[] = [];
      await textSummaryFn({ text: "input" } as any, model, new AbortController().signal, (e) =>
        events.push(e)
      );

      const { usage } = events.at(-1);
      expect(usage.input).toBe(5);
      expect(usage.cached).toBeUndefined();
      expect(usage.cacheWrite).toBeUndefined();
      expect(usage.reasoning).toBeUndefined();
      expect(usage.total).toBeUndefined();
    });
  });
});
