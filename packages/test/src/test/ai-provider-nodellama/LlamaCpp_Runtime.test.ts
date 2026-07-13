/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  acquireContextSequence,
  getOrCreateEmbeddingContext,
  isVramError,
  llamaCppEmbeddingContexts,
  llamaCppModels,
  llamaCppTextContexts,
  recycleLlamaCppTextContext,
} from "@workglow/node-llama-cpp/ai-runtime";
import type {
  LlamaContext,
  LlamaContextSequence,
  LlamaEmbeddingContext,
  LlamaModel,
} from "node-llama-cpp";
import { afterEach, describe, expect, it, vi } from "vitest";

function makeFakeContext(reclaimAfter: number): {
  context: LlamaContext;
  getSequenceCalls: () => number;
} {
  let ticks = 0;
  let calls = 0;
  const tick = (): void => {
    ticks += 1;
  };
  const pump = (): void => {
    if (ticks < reclaimAfter) setTimeout(pump, 0);
  };
  setTimeout(pump, 0);

  const context = {
    get sequencesLeft(): number {
      tick();
      return ticks >= reclaimAfter ? 1 : 0;
    },
    getSequence(): LlamaContextSequence {
      calls += 1;
      if (ticks < reclaimAfter) throw new Error("No sequences left");
      return { id: "seq" } as unknown as LlamaContextSequence;
    },
  } as unknown as LlamaContext;

  return { context, getSequenceCalls: () => calls };
}

describe("acquireContextSequence", () => {
  it("returns immediately when a sequence is already free", async () => {
    const { context, getSequenceCalls } = makeFakeContext(0);
    const seq = await acquireContextSequence(context);
    expect(seq).toBeDefined();
    expect(getSequenceCalls()).toBe(1);
  });

  it("waits for a deferred reclaim instead of throwing 'No sequences left'", async () => {
    const { context, getSequenceCalls } = makeFakeContext(3);
    const seq = await acquireContextSequence(context);
    expect(seq).toBeDefined();
    expect(getSequenceCalls()).toBe(1);
  });
});

describe("isVramError classification", () => {
  const cases: readonly { readonly msg: string; readonly expected: boolean }[] = [
    { msg: "CUDA error: out of memory", expected: true },
    {
      msg: "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 8192.00 MiB on device 0: cudaMalloc failed",
      expected: true,
    },
    { msg: "MTLBuffer allocation failed", expected: true },
    { msg: "hipMalloc failed", expected: true },
    { msg: "HIP out of memory", expected: true },
    { msg: "VK_ERROR_OUT_OF_DEVICE_MEMORY", expected: true },
    { msg: "Not enough VRAM to load model", expected: true },
    { msg: "failed to allocate buffer", expected: true },
    { msg: "too large for the available VRAM", expected: true },
    { msg: "ENOENT: no such file or directory", expected: false },
    { msg: "invalid model file", expected: false },
    { msg: "No sequences left", expected: false },
    { msg: "", expected: false },
  ];

  it.each(cases)("classifies $msg as $expected", ({ msg, expected }) => {
    expect(isVramError(new Error(msg))).toBe(expected);
    expect(isVramError(msg)).toBe(expected);
  });
});

describe("recycleLlamaCppTextContext with reloadModel disposes embedding context", () => {
  afterEach(() => {
    llamaCppModels.clear();
    llamaCppTextContexts.clear();
    llamaCppEmbeddingContexts.clear();
  });

  it("disposes the model, text context, and embedding context for the target key", async () => {
    const modelDisposeA = vi.fn(async () => {});
    const textDisposeA = vi.fn(async () => {});
    const embeddingDisposeA = vi.fn(async () => {});
    const modelDisposeB = vi.fn(async () => {});
    const textDisposeB = vi.fn(async () => {});
    const embeddingDisposeB = vi.fn(async () => {});

    const modelA = { dispose: modelDisposeA } as unknown as LlamaModel;
    const textA = { dispose: textDisposeA } as unknown as LlamaContext;
    const embeddingA = { dispose: embeddingDisposeA } as unknown as LlamaEmbeddingContext;
    const modelB = { dispose: modelDisposeB } as unknown as LlamaModel;
    const textB = { dispose: textDisposeB } as unknown as LlamaContext;
    const embeddingB = { dispose: embeddingDisposeB } as unknown as LlamaEmbeddingContext;

    llamaCppModels.set("/tmp/a.gguf", modelA);
    llamaCppTextContexts.set("/tmp/a.gguf", textA);
    llamaCppEmbeddingContexts.set("/tmp/a.gguf", embeddingA);
    llamaCppModels.set("/tmp/b.gguf", modelB);
    llamaCppTextContexts.set("/tmp/b.gguf", textB);
    llamaCppEmbeddingContexts.set("/tmp/b.gguf", embeddingB);

    await recycleLlamaCppTextContext("/tmp/a.gguf", { reloadModel: true });

    expect(llamaCppModels.has("/tmp/a.gguf")).toBe(false);
    expect(llamaCppTextContexts.has("/tmp/a.gguf")).toBe(false);
    expect(llamaCppEmbeddingContexts.has("/tmp/a.gguf")).toBe(false);

    expect(llamaCppModels.get("/tmp/b.gguf")).toBe(modelB);
    expect(llamaCppTextContexts.get("/tmp/b.gguf")).toBe(textB);
    expect(llamaCppEmbeddingContexts.get("/tmp/b.gguf")).toBe(embeddingB);

    expect(modelDisposeA).toHaveBeenCalledTimes(1);
    expect(textDisposeA).toHaveBeenCalledTimes(1);
    expect(embeddingDisposeA).toHaveBeenCalledTimes(1);

    expect(modelDisposeB).not.toHaveBeenCalled();
    expect(textDisposeB).not.toHaveBeenCalled();
    expect(embeddingDisposeB).not.toHaveBeenCalled();
  });
});

describe("getOrCreateEmbeddingContext under VRAM pressure", () => {
  afterEach(() => {
    llamaCppModels.clear();
    llamaCppTextContexts.clear();
    llamaCppEmbeddingContexts.clear();
  });

  it("evicts the LRU cached model and retries after createEmbeddingContext throws a VRAM error", async () => {
    const stubEmbeddingContext = {
      dispose: vi.fn(async () => {}),
    } as unknown as LlamaEmbeddingContext;

    const createEmbeddingContext = vi
      .fn()
      .mockRejectedValueOnce(new Error("CUDA error: out of memory"))
      .mockResolvedValueOnce(stubEmbeddingContext);

    const stubModel = {
      createEmbeddingContext,
      dispose: vi.fn(async () => {}),
    } as unknown as LlamaModel;

    const stubLRUModel = {
      dispose: vi.fn(async () => {}),
    } as unknown as LlamaModel;
    const stubLRUCtx = {
      dispose: vi.fn(async () => {}),
    } as unknown as LlamaContext;

    llamaCppModels.set("/tmp/lru.gguf", stubLRUModel);
    llamaCppTextContexts.set("/tmp/lru.gguf", stubLRUCtx);
    llamaCppModels.set("/tmp/target.gguf", stubModel);

    const result = await getOrCreateEmbeddingContext({
      model_id: "t",
      provider_config: { model_path: "/tmp/target.gguf" },
    } as any);

    expect(result).toBe(stubEmbeddingContext);
    expect(createEmbeddingContext).toHaveBeenCalledTimes(2);
    expect(llamaCppModels.has("/tmp/lru.gguf")).toBe(false);
    expect(llamaCppTextContexts.has("/tmp/lru.gguf")).toBe(false);
    expect(llamaCppEmbeddingContexts.get("/tmp/target.gguf")).toBe(stubEmbeddingContext);
  });
});
