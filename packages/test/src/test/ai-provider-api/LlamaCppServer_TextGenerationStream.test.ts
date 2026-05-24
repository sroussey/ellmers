/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createLlamaCppServerTextGenerationStream } from "@workglow/llamacpp-server/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function dataLine(delta: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLlamaCppServerTextGenerationStream", () => {
  const model = { provider_config: { base_url: "http://localhost:8080", model_name: "m" } } as any;

  it("yields text-delta events for each delta line and a final finish", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sseResponse([dataLine("Hel"), dataLine("lo"), "data: [DONE]\n"]));
    const fn = createLlamaCppServerTextGenerationStream({});

    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ prompt: "hi" } as any, model, undefined as any, emit);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8080/v1/chat/completions");
    expect(events.filter((e) => e.type === "text-delta").map((e) => e.textDelta)).toEqual([
      "Hel",
      "lo",
    ]);
    expect(events[events.length - 1].type).toBe("finish");
  });

  it("uses chat messages when input.messages is non-empty", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sseResponse([dataLine("ok"), "data: [DONE]\n"]));
    const fn = createLlamaCppServerTextGenerationStream({});
    const emit = (_e: any) => undefined;
    await fn(
      {
        prompt: "ignored",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: "be helpful",
      } as any,
      model,
      undefined as any,
      emit
    );
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body.messages).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ]);
  });

  it("throws on non-2xx with informative message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const fn = createLlamaCppServerTextGenerationStream({});
    const emit = (_e: any) => undefined;
    await expect(fn({ prompt: "x" } as any, model, undefined as any, emit)).rejects.toThrow(
      /HTTP 500/
    );
  });

  it("aborts pending fetch when signal aborts before request", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([dataLine("ok"), "data: [DONE]\n"])
    );
    const fn = createLlamaCppServerTextGenerationStream({});
    const emit = (_e: any) => undefined;
    await expect(fn({ prompt: "x" } as any, model, controller.signal, emit)).rejects.toThrow();
  });
});
