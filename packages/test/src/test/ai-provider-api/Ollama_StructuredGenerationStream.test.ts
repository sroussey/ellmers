/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createEmitQueue } from "@workglow/ai";
import { createOllamaStructuredGenerationStream } from "@workglow/ollama/ai-runtime";
import { describe, expect, it, vi } from "vitest";

type FakeStream = {
  abort: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator](): AsyncIterator<{ message: { content: string } }>;
};

function makeFakeStream(chunks: string[]): FakeStream {
  let aborted = false;
  const abort = vi.fn(() => {
    aborted = true;
  });
  return {
    abort,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        if (aborted) return;
        yield { message: { content: c } };
      }
    },
  };
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === "AbortError") return true;
  return typeof e.message === "string" && e.message.toLowerCase().includes("abort");
}

const model = {
  model_id: "ollama:test",
  provider_config: { model_name: "llama3.2" },
} as any;
const input = { prompt: "weather in Paris", outputSchema: { type: "object" } } as any;

describe("createOllamaStructuredGenerationStream", () => {
  it("passes the output schema as `format` and emits progressive object-delta on the `object` port", async () => {
    const fakeStream = makeFakeStream(['{"city":"Par', 'is","temp":2', "0}"]);
    const chat = vi.fn().mockResolvedValue(fakeStream);
    const getClient = vi.fn().mockResolvedValue({ chat });
    const streamFn = createOllamaStructuredGenerationStream(getClient);

    const events: any[] = [];
    await streamFn(input, model, undefined as any, (e) => events.push(e));

    // The output schema is handed to Ollama as the chat `format` parameter.
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0]).toMatchObject({ format: input.outputSchema, stream: true });

    const objectDeltas = events.filter((e) => e.type === "object-delta");
    expect(objectDeltas.length).toBeGreaterThan(0);
    for (const d of objectDeltas) {
      expect(d.port).toBe("object");
      expect(typeof d.objectDelta).toBe("object");
      expect(d.objectDelta).not.toBeNull();
    }

    // Per the structured-generation convention, the terminal finish carries the
    // fully parsed object in data.object.
    const finish = events[events.length - 1];
    expect(finish).toEqual({ type: "finish", data: { object: { city: "Paris", temp: 20 } } });
  });

  it("recovers finish.data.object via partial JSON when the stream ends with truncated JSON", async () => {
    // No closing brace: JSON.parse fails and parsePartialJson recovers the object.
    const fakeStream = makeFakeStream(['{"city":"Paris","temp":20']);
    const getClient = vi.fn().mockResolvedValue({ chat: vi.fn().mockResolvedValue(fakeStream) });
    const streamFn = createOllamaStructuredGenerationStream(getClient);

    const events: any[] = [];
    await streamFn(input, model, undefined as any, (e) => events.push(e));

    const finish = events[events.length - 1];
    expect(finish.type).toBe("finish");
    expect(finish.data.object).toMatchObject({ city: "Paris", temp: 20 });
  });

  it("rejects before any client call or emit when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const getClient = vi.fn().mockResolvedValue({ chat: vi.fn() });
    const streamFn = createOllamaStructuredGenerationStream(getClient);

    const events: any[] = [];
    let caught: unknown;
    await streamFn(input, model, controller.signal, (e) => events.push(e)).catch((e) => {
      caught = e;
    });

    expect(isAbortError(caught)).toBe(true);
    expect(getClient).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("aborts the underlying stream exactly once when the signal aborts mid-iteration", async () => {
    const chunks = ['{"a":1', ',"b":2', ',"c":3', ',"d":4', ',"e":5}'];
    const fakeStream = makeFakeStream(chunks);
    const getClient = vi.fn().mockResolvedValue({ chat: vi.fn().mockResolvedValue(fakeStream) });
    const streamFn = createOllamaStructuredGenerationStream(getClient);

    const controller = new AbortController();
    const objectDeltas: any[] = [];
    const q = createEmitQueue<any>();
    const runP = streamFn(input, model, controller.signal, (e) => q.push(e)).then(
      () => q.close(),
      () => q.close()
    );
    for await (const ev of q.iterable) {
      if (ev.type === "object-delta") {
        objectDeltas.push(ev);
        if (objectDeltas.length === 2) controller.abort();
      }
    }
    await runP;

    expect(fakeStream.abort).toHaveBeenCalledTimes(1);
    expect(objectDeltas.length).toBeLessThan(chunks.length);
    expect(objectDeltas.length).toBeGreaterThanOrEqual(2);
  });
});
