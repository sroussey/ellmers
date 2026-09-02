/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HfTransformersOnnxModelConfig } from "@workglow/huggingface-transformers/ai-runtime";
import {
  abortableFetch,
  getHftFetchStallTimeoutMs,
  getPipeline,
  getPipelineCacheKey,
  HftDownloadStalledError,
  modelAbortControllers,
  pipelineLoadPromises,
  pipelines,
  setHftFetchStallTimeoutMs,
  wrapAbortableResponse,
} from "@workglow/huggingface-transformers/ai-runtime";
import type { StreamPhase } from "@workglow/task-graph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STALL_MS = 40;
const MODEL_URL = "https://huggingface.co/Test/stall-model/resolve/main/onnx/model_q4f16.onnx";

/**
 * A body stream that delivers `chunks` and then goes silent forever — the
 * shape of a connection that died mid-transfer without the browser noticing.
 */
function silentAfter(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < chunks.length) {
        controller.enqueue(chunks[sent++]);
        return;
      }
      // Never enqueue, never close: the read hangs.
      return new Promise<void>(() => {});
    },
  });
}

describe("HFT fetch stall watchdog", () => {
  let originalTimeout: number;

  beforeEach(() => {
    originalTimeout = getHftFetchStallTimeoutMs();
    setHftFetchStallTimeoutMs(STALL_MS);
  });

  afterEach(() => {
    setHftFetchStallTimeoutMs(originalTimeout);
    vi.unstubAllGlobals();
  });

  it("errors a body stream that goes silent mid-transfer with a DownloadStalledError", async () => {
    const stallController = new AbortController();
    const response = new Response(silentAfter([new Uint8Array([1, 2, 3])]), {
      status: 200,
      headers: { "content-length": "1000" },
    });

    const wrapped = wrapAbortableResponse(response, stallController.signal, {
      controller: stallController,
      url: MODEL_URL,
    });
    const reader = wrapped.body!.getReader();

    // Data that does arrive flows through untouched.
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(Array.from(first.value!)).toEqual([1, 2, 3]);

    // The next read never gets bytes: the watchdog must reject it.
    let caught: unknown;
    try {
      await reader.read();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HftDownloadStalledError);
    const stalled = caught as HftDownloadStalledError;
    expect(stalled.name).toBe("DownloadStalledError");
    expect(stalled.url).toBe(MODEL_URL);
    expect(stalled.bytesReceived).toBe(3);
    // The message must not read as a user cancellation to AiJob's classifier.
    expect(stalled.message).not.toMatch(/aborted/i);

    // The watchdog also fires the fetch's controller so the socket is torn down.
    expect(stallController.signal.aborted).toBe(true);
    expect(stallController.signal.reason).toBe(stalled);
  });

  it("does not fire while data keeps arriving slower than the timeout in total", async () => {
    const stallController = new AbortController();
    // Three chunks, each delayed by half the stall window: total time exceeds
    // the window but no single gap does, so the watchdog must stay quiet.
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === 3) {
          controller.close();
          return;
        }
        await new Promise((r) => setTimeout(r, STALL_MS / 2));
        controller.enqueue(new Uint8Array([sent++]));
      },
    });
    const response = new Response(body, { status: 200 });
    const wrapped = wrapAbortableResponse(response, stallController.signal, {
      controller: stallController,
      url: MODEL_URL,
    });

    const bytes = new Uint8Array(await wrapped.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0, 1, 2]);
    expect(stallController.signal.aborted).toBe(false);
  });

  it("rejects a fetch whose response headers never arrive", async () => {
    let capturedSignal: AbortSignal | undefined;
    const neverResponds = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", neverResponds);

    await expect(abortableFetch(MODEL_URL)).rejects.toBeInstanceOf(HftDownloadStalledError);
    expect(neverResponds).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("is disabled when the timeout is zero", async () => {
    setHftFetchStallTimeoutMs(0);
    const stallController = new AbortController();
    const response = new Response(silentAfter([new Uint8Array([9])]), { status: 200 });
    const wrapped = wrapAbortableResponse(response, stallController.signal, {
      controller: stallController,
      url: MODEL_URL,
    });
    const reader = wrapped.body!.getReader();
    await reader.read();

    // With the watchdog off the second read simply hangs; give it a few
    // stall windows to prove nothing fires, then move on.
    const outcome = await Promise.race([
      reader.read().then(() => "settled"),
      new Promise<string>((r) => setTimeout(() => r("still pending"), STALL_MS * 3)),
    ]);
    expect(outcome).toBe("still pending");
    expect(stallController.signal.aborted).toBe(false);
    reader.cancel().catch(() => {});
  });

  it("still lets a user abort win over the watchdog", async () => {
    const userController = new AbortController();
    const stallController = new AbortController();
    const combined = AbortSignal.any([userController.signal, stallController.signal]);
    const response = new Response(silentAfter([]), { status: 200 });
    const wrapped = wrapAbortableResponse(response, combined, {
      controller: stallController,
      url: MODEL_URL,
    });
    const reader = wrapped.body!.getReader();
    const pending = reader.read();
    userController.abort(new Error("Pipeline download aborted"));

    await expect(pending).rejects.toThrow("Pipeline download aborted");
    expect(stallController.signal.aborted).toBe(false);
  });
});

describe("getPipeline: joining an in-flight load", () => {
  const model: HfTransformersOnnxModelConfig = {
    model_id: "onnx:Test/stall-model:q4f16",
    title: "stall-model",
    description: "test fixture",
    capabilities: ["text.generation"],
    provider: "hf-transformers-onnx",
    provider_config: {
      pipeline: "text-generation",
      model_path: "Test/stall-model",
      dtype: "q4f16",
    },
    metadata: {},
  } as unknown as HfTransformersOnnxModelConfig;
  const cacheKey = getPipelineCacheKey(model);

  afterEach(() => {
    pipelineLoadPromises.clear();
    pipelines.clear();
    modelAbortControllers.clear();
  });

  it("tells the caller it is waiting and rejects promptly when the caller aborts", async () => {
    // A load that never settles: the shape of a cancelled download whose
    // worker-side unwind is still in progress.
    const zombie = new Promise<never>(() => {});
    pipelineLoadPromises.set(cacheKey, zombie);

    const events: StreamPhase[] = [];
    const controller = new AbortController();
    const joined = getPipeline(model, (e) => events.push(e), {}, controller.signal, 100);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("phase");
    expect(events[0].message).toMatch(/waiting/i);
    expect(events[0].progress).toBeUndefined();

    controller.abort(new Error("Pipeline download aborted"));
    await expect(joined).rejects.toThrow("Pipeline download aborted");

    // The joiner never started a load of its own, so the original entry is
    // untouched and nothing was cached.
    expect(pipelineLoadPromises.get(cacheKey)).toBe(zombie);
    expect(pipelines.has(cacheKey)).toBe(false);
  });

  it("returns the cached pipeline when the in-flight load it joined succeeds", async () => {
    const fake = { model: { dispose: vi.fn(async () => {}) } };
    let finish!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      finish = () => {
        (pipelines as Map<string, unknown>).set(cacheKey, fake);
        resolve();
      };
    });
    pipelineLoadPromises.set(cacheKey, inFlight);

    const controller = new AbortController();
    const joined = getPipeline(model, () => {}, {}, controller.signal, 100);
    finish();

    await expect(joined).resolves.toBe(fake);
    expect(controller.signal.aborted).toBe(false);
  });
});
