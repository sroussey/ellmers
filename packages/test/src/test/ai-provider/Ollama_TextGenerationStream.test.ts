/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { createOllamaTextGenerationStream } from "@workglow/ollama/ai-provider-runtime";

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

describe("createOllamaTextGenerationStream abort behavior", () => {
  const model = {
    model_id: "ollama:test",
    provider_config: { model_name: "llama3.2" },
  } as any;
  const input = { prompt: "hi" } as any;

  it("yields zero deltas and aborts the stream when signal aborts during chat() (pre-attach race)", async () => {
    const fakeStream = makeFakeStream(["a", "b", "c"]);
    const controller = new AbortController();
    const getClient = vi.fn().mockResolvedValue({
      chat: vi.fn().mockImplementation(async () => {
        // Simulate the signal aborting after the pre-call throwIfAborted check
        // but before the abort listener is attached — the bug class this fix targets.
        controller.abort();
        return fakeStream;
      }),
    });
    const streamFn = createOllamaTextGenerationStream(getClient);

    const events: any[] = [];
    let caught: unknown;
    try {
      for await (const ev of streamFn(input, model, controller.signal)) {
        events.push(ev);
      }
    } catch (err) {
      caught = err;
    }

    const deltas = events.filter((e) => e.type === "text-delta");
    expect(deltas).toHaveLength(0);
    expect(fakeStream.abort).toHaveBeenCalledTimes(1);
    // post-attach throwIfAborted should propagate the abort as an AbortError
    expect(isAbortError(caught)).toBe(true);
  });

  it("does not throw when signal is undefined", async () => {
    const fakeStream = makeFakeStream(["hello", " world"]);
    const getClient = vi.fn().mockResolvedValue({
      chat: vi.fn().mockResolvedValue(fakeStream),
    });
    const streamFn = createOllamaTextGenerationStream(getClient);

    const events: any[] = [];
    for await (const ev of streamFn(input, model, undefined as any)) {
      events.push(ev);
    }

    const deltas = events
      .filter((e) => e.type === "text-delta")
      .map((e) => (e as any).textDelta);
    expect(deltas).toEqual(["hello", " world"]);
    expect(events[events.length - 1]).toEqual({ type: "finish", data: {} });
    expect(fakeStream.abort).not.toHaveBeenCalled();
  });

  it("calls fakeStream.abort exactly once when signal is aborted mid-iteration", async () => {
    const chunks = ["one", "two", "three", "four", "five"];
    const fakeStream = makeFakeStream(chunks);
    const getClient = vi.fn().mockResolvedValue({
      chat: vi.fn().mockResolvedValue(fakeStream),
    });
    const streamFn = createOllamaTextGenerationStream(getClient);

    const controller = new AbortController();
    const deltas: string[] = [];

    for await (const ev of streamFn(input, model, controller.signal)) {
      if (ev.type === "text-delta") {
        deltas.push(ev.textDelta);
        if (deltas.length === 2) {
          controller.abort();
        }
      }
    }

    expect(fakeStream.abort).toHaveBeenCalledTimes(1);
    expect(deltas.length).toBeLessThan(chunks.length);
    expect(deltas.length).toBeGreaterThanOrEqual(2);
  });
});
