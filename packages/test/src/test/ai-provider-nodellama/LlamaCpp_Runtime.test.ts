/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  acquireContextSequence,
  acquireModelInUse,
  captureSequenceTokenBoundary,
  disposeLlamaCppSessionsForModel,
  getLlamaCppSession,
  getOrCreateEmbeddingContext,
  isVramError,
  llamaCppEmbeddingContexts,
  llamaCppModels,
  llamaCppSessions,
  llamaCppTextContexts,
  recycleLlamaCppTextContext,
  releaseModelInUse,
  resolvedPaths,
  restoreLlamaCppCheckpointSession,
  setLlamaCppSession,
  stealLlamaCppSession,
  withSequence,
  withSessionLock,
  withVramEviction,
} from "@workglow/node-llama-cpp/ai-runtime";
import type {
  LlamaContext,
  LlamaContextSequence,
  LlamaEmbeddingContext,
  LlamaModel,
} from "node-llama-cpp";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Fake context whose `sequencesLeft` reports zero for the first `reclaimAfter`
 * `sequencesLeft` reads, simulating the async reclaim path.
 */
function makeReclaimAfterContext(reclaimAfter: number): {
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

/**
 * Fake context whose `sequencesLeft` always returns 1 but whose `getSequence`
 * throws `"No sequences left"` for the first `retriesBeforeSuccess` calls —
 * exactly the race path {@link acquireContextSequence} was written to tolerate.
 */
function makeGetSequenceRetryContext(retriesBeforeSuccess: number): {
  context: LlamaContext;
  getSequenceCalls: () => number;
} {
  let calls = 0;
  const context = {
    get sequencesLeft(): number {
      return 1;
    },
    getSequence(): LlamaContextSequence {
      calls += 1;
      if (calls <= retriesBeforeSuccess) throw new Error("No sequences left");
      return { id: "seq" } as unknown as LlamaContextSequence;
    },
  } as unknown as LlamaContext;
  return { context, getSequenceCalls: () => calls };
}

describe("acquireContextSequence", () => {
  it("returns immediately when a sequence is already free", async () => {
    const { context, getSequenceCalls } = makeReclaimAfterContext(0);
    const seq = await acquireContextSequence(context);
    expect(seq).toBeDefined();
    expect(getSequenceCalls()).toBe(1);
  });

  it("waits for a deferred reclaim before calling getSequence", async () => {
    const { context, getSequenceCalls } = makeReclaimAfterContext(3);
    const seq = await acquireContextSequence(context);
    expect(seq).toBeDefined();
    expect(getSequenceCalls()).toBe(1);
  });

  it("retries when getSequence throws 'No sequences left' while sequencesLeft says slots are free", async () => {
    const { context, getSequenceCalls } = makeGetSequenceRetryContext(3);
    const seq = await acquireContextSequence(context);
    expect(seq).toBeDefined();
    // 3 failing calls then a fourth that succeeds.
    expect(getSequenceCalls()).toBe(4);
  });

  it("rejects immediately when the abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const context = {
      get sequencesLeft(): number {
        return 1;
      },
      getSequence(): LlamaContextSequence {
        return { id: "seq" } as unknown as LlamaContextSequence;
      },
    } as unknown as LlamaContext;

    await expect(acquireContextSequence(context, controller.signal)).rejects.toBeDefined();
  });
});

describe("withSequence", () => {
  it("disposes the sequence exactly once when the body throws", async () => {
    const seqDispose = vi.fn(async () => {});
    const stubSequence = { dispose: seqDispose } as unknown as LlamaContextSequence;
    const context = {
      get sequencesLeft(): number {
        return 1;
      },
      getSequence(): LlamaContextSequence {
        return stubSequence;
      },
    } as unknown as LlamaContext;

    await expect(
      withSequence(context, async () => {
        throw new Error("session ctor failed");
      })
    ).rejects.toThrow("session ctor failed");

    expect(seqDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the sequence after a successful run", async () => {
    const seqDispose = vi.fn(async () => {});
    const stubSequence = { dispose: seqDispose } as unknown as LlamaContextSequence;
    const context = {
      get sequencesLeft(): number {
        return 1;
      },
      getSequence(): LlamaContextSequence {
        return stubSequence;
      },
    } as unknown as LlamaContext;

    const result = await withSequence(context, async () => "ok");
    expect(result).toBe("ok");
    expect(seqDispose).toHaveBeenCalledTimes(1);
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

describe("withVramEviction concurrent-safety", () => {
  afterEach(() => {
    llamaCppModels.clear();
    llamaCppTextContexts.clear();
    llamaCppEmbeddingContexts.clear();
  });

  it("skips models marked in-use during LRU eviction", async () => {
    const modelDisposeA = vi.fn(async () => {});
    const modelDisposeB = vi.fn(async () => {});
    const modelA = { dispose: modelDisposeA } as unknown as LlamaModel;
    const modelB = { dispose: modelDisposeB } as unknown as LlamaModel;
    llamaCppModels.set("/tmp/A.gguf", modelA);
    llamaCppModels.set("/tmp/B.gguf", modelB);

    // B is powering a concurrent run and must survive the eviction sweep.
    acquireModelInUse("/tmp/B.gguf");

    let attempts = 0;
    const attempt = async (): Promise<string> => {
      attempts += 1;
      if (attempts === 1) throw new Error("cuda out of memory");
      return "ok";
    };

    try {
      const result = await withVramEviction("/tmp/C.gguf", attempt);

      expect(result).toBe("ok");
      expect(modelDisposeA).toHaveBeenCalledTimes(1);
      expect(modelDisposeB).not.toHaveBeenCalled();
      expect(llamaCppModels.has("/tmp/A.gguf")).toBe(false);
      expect(llamaCppModels.get("/tmp/B.gguf")).toBe(modelB);
    } finally {
      releaseModelInUse("/tmp/B.gguf");
    }
  });

  it("rethrows the original VRAM error when every candidate is in-use", async () => {
    const modelDisposeA = vi.fn(async () => {});
    const modelA = { dispose: modelDisposeA } as unknown as LlamaModel;
    llamaCppModels.set("/tmp/A.gguf", modelA);
    acquireModelInUse("/tmp/A.gguf");

    const original = new Error("cuda out of memory");
    const attempt = () => Promise.reject(original);

    try {
      await expect(withVramEviction("/tmp/B.gguf", attempt)).rejects.toBe(original);
      expect(modelDisposeA).not.toHaveBeenCalled();
      expect(llamaCppModels.get("/tmp/A.gguf")).toBe(modelA);
    } finally {
      releaseModelInUse("/tmp/A.gguf");
    }
  });
});

describe("disposeLlamaCppSessionsForModel key-spelling tolerance", () => {
  afterEach(() => {
    llamaCppSessions.clear();
    resolvedPaths.clear();
  });

  it("disposes sessions stored under the config key when called with the resolved on-disk path", async () => {
    // Sessions are stored with `modelKey: getConfigKey(model)` (typically `model_url`),
    // but `evictLeastRecentlyUsedModel` iterates `llamaCppModels` keys, which are
    // resolved filesystem paths. The dispose helper must match both spellings.
    const configKey = "https://huggingface.co/example/model.gguf";
    const resolvedPath = "/tmp/example/model.gguf";
    resolvedPaths.set(configKey, resolvedPath);

    const sessionDispose = vi.fn(async () => {});
    const sequenceDispose = vi.fn(async () => {});
    setLlamaCppSession("session-1", {
      session: { dispose: sessionDispose } as unknown as never,
      sequence: { dispose: sequenceDispose } as unknown as never,
      modelKey: configKey,
    } as never);

    await disposeLlamaCppSessionsForModel(resolvedPath);

    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(sequenceDispose).toHaveBeenCalledTimes(1);
    expect(llamaCppSessions.has("session-1")).toBe(false);
  });

  it("still disposes sessions when the caller passes the exact stored key", async () => {
    const configKey = "/tmp/local/model.gguf";
    const sessionDispose = vi.fn(async () => {});
    setLlamaCppSession("session-2", {
      session: { dispose: sessionDispose } as unknown as never,
      sequence: undefined as unknown as never,
      modelKey: configKey,
    } as never);

    await disposeLlamaCppSessionsForModel(configKey);

    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(llamaCppSessions.has("session-2")).toBe(false);
  });

  it("does not dispose sessions belonging to a different model", async () => {
    resolvedPaths.set("url-A", "/tmp/A.gguf");
    resolvedPaths.set("url-B", "/tmp/B.gguf");

    const sessionADispose = vi.fn(async () => {});
    const sessionBDispose = vi.fn(async () => {});
    setLlamaCppSession("sess-A", {
      session: { dispose: sessionADispose } as unknown as never,
      sequence: undefined as unknown as never,
      modelKey: "url-A",
    } as never);
    setLlamaCppSession("sess-B", {
      session: { dispose: sessionBDispose } as unknown as never,
      sequence: undefined as unknown as never,
      modelKey: "url-B",
    } as never);

    await disposeLlamaCppSessionsForModel("/tmp/A.gguf");

    expect(sessionADispose).toHaveBeenCalledTimes(1);
    expect(sessionBDispose).not.toHaveBeenCalled();
    expect(llamaCppSessions.has("sess-A")).toBe(false);
    expect(llamaCppSessions.has("sess-B")).toBe(true);
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

describe("withSessionLock", () => {
  it("serializes two concurrent callers on the same sessionId", async () => {
    const sessionId = "shared-session-a";
    let release1: () => void = () => {};
    const finish1 = new Promise<void>((resolve) => {
      release1 = resolve;
    });
    const events: string[] = [];

    const first = withSessionLock(sessionId, async () => {
      events.push("first:start");
      await finish1;
      events.push("first:end");
      return "one";
    });
    const second = withSessionLock(sessionId, async () => {
      events.push("second:start");
      return "two";
    });

    // Give the microtask queue a couple of ticks — if the lock is missing, the
    // second body would race in and log its start before the first is released.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    release1();
    expect(await first).toEqual("one");
    expect(await second).toEqual("two");
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("allows unrelated sessionIds to run in parallel", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let bStarted = false;
    const a = withSessionLock("session-a", async () => {
      await gate;
      return "a";
    });
    const b = withSessionLock("session-b", async () => {
      bStarted = true;
      return "b";
    });

    await Promise.resolve();
    await Promise.resolve();
    // If sessionLocks were global, `b` would still be waiting on `a`.
    expect(bStarted).toBe(true);
    expect(await b).toEqual("b");

    release();
    expect(await a).toEqual("a");
  });

  it("releases the lock even when the body throws", async () => {
    const sessionId = "throwing-session";
    await expect(
      withSessionLock(sessionId, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    // A subsequent call must be able to proceed immediately.
    const result = await withSessionLock(sessionId, async () => "ok");
    expect(result).toEqual("ok");
  });
});

describe("stealLlamaCppSession", () => {
  afterEach(() => {
    llamaCppSessions.clear();
  });

  it("atomically returns and removes the state for a known session id", () => {
    const state = {
      mode: "prefix-rewind" as const,
      sequence: { id: "seq-A" } as unknown,
      session: { id: "session-A" } as unknown,
      modelKey: "modelA",
    };
    setLlamaCppSession("ckpt-A", state);
    // Sanity: present before the steal.
    expect(getLlamaCppSession("ckpt-A")).toBe(state);

    const stolen = stealLlamaCppSession("ckpt-A");

    // Exactly one caller receives the state.
    expect(stolen).toBe(state);
    // Post-steal the entry is gone — the loser of a concurrent steal
    // observes `undefined` and re-encodes via the missing-state fallback.
    expect(getLlamaCppSession("ckpt-A")).toBeUndefined();
    expect(llamaCppSessions.has("ckpt-A")).toBe(false);
    // A second steal of the same id must not re-return the stale state.
    expect(stealLlamaCppSession("ckpt-A")).toBeUndefined();
  });

  it("returns undefined for an unknown session id without mutating the map", () => {
    const other = {
      mode: "progressive" as const,
      sequence: { id: "seq-B" } as unknown,
      session: { id: "session-B" } as unknown,
      modelKey: "modelB",
    };
    setLlamaCppSession("ckpt-B", other);

    expect(stealLlamaCppSession("nonexistent")).toBeUndefined();
    // Other entries are untouched.
    expect(getLlamaCppSession("ckpt-B")).toBe(other);
    expect(llamaCppSessions.size).toBe(1);
  });
});

describe("restoreLlamaCppCheckpointSession", () => {
  afterEach(() => {
    llamaCppSessions.clear();
  });

  function makeRewindableSequence(prefixTokens: number[]) {
    const sequence = {
      contextTokens: [...prefixTokens],
      get nextTokenIndex(): number {
        return this.contextTokens.length;
      },
      eraseContextTokenRanges: vi.fn(async (ranges: Array<{ start: number; end: number }>) => {
        for (const { start, end } of ranges) {
          sequence.contextTokens.splice(start, end - start);
        }
      }),
      dispose: vi.fn(async () => {}),
    };
    return sequence;
  }

  function makeState(sequence: unknown) {
    const setChatHistory = vi.fn();
    return {
      state: {
        mode: "prefix-rewind" as const,
        sequence: sequence as never,
        session: { setChatHistory, dispose: vi.fn(async () => {}) } as never,
        modelKey: "model-key",
      },
      setChatHistory,
    };
  }

  it("erases the turn's tokens, resets the history, and re-registers the entry", async () => {
    const sequence = makeRewindableSequence([1, 2, 3]);
    const boundary = captureSequenceTokenBoundary(sequence);
    expect(boundary).toEqual({ index: 3, prefixTokens: [1, 2, 3] });
    // The generated turn appends tokens past the boundary.
    sequence.contextTokens.push(4, 5);
    const { state, setChatHistory } = makeState(sequence);
    const prefixHistory = [{ type: "system", text: "sys" }];

    const restored = await restoreLlamaCppCheckpointSession("ckpt-r", state, boundary, [
      ...prefixHistory,
    ]);

    expect(restored).toBe(true);
    expect(sequence.eraseContextTokenRanges).toHaveBeenCalledWith([{ start: 3, end: 5 }]);
    expect(sequence.contextTokens).toEqual([1, 2, 3]);
    expect(setChatHistory).toHaveBeenCalledWith(prefixHistory);
    expect(llamaCppSessions.get("ckpt-r")).toBe(state);
  });

  it("refuses to restore when the id was re-registered by a concurrent consumer", async () => {
    const sequence = makeRewindableSequence([1, 2]);
    const boundary = captureSequenceTokenBoundary(sequence);
    const occupant = makeState(makeRewindableSequence([9])).state;
    setLlamaCppSession("ckpt-busy", occupant);
    const { state } = makeState(sequence);

    const restored = await restoreLlamaCppCheckpointSession("ckpt-busy", state, boundary, []);

    expect(restored).toBe(false);
    // The occupant is never overwritten (that would strand its sequence).
    expect(llamaCppSessions.get("ckpt-busy")).toBe(occupant);
    expect(sequence.eraseContextTokenRanges).not.toHaveBeenCalled();
  });

  it("refuses to restore when a context shift rewrote the prefix cells", async () => {
    const sequence = makeRewindableSequence([1, 2, 3]);
    const boundary = captureSequenceTokenBoundary(sequence);
    // Simulate a context shift during the turn: cell 0 was dropped and the
    // remaining tokens moved down, so a positional rewind would be unsound.
    sequence.contextTokens.splice(0, 1);
    sequence.contextTokens.push(4, 5);
    const { state, setChatHistory } = makeState(sequence);

    const restored = await restoreLlamaCppCheckpointSession("ckpt-shifted", state, boundary, []);

    expect(restored).toBe(false);
    expect(sequence.eraseContextTokenRanges).not.toHaveBeenCalled();
    expect(setChatHistory).not.toHaveBeenCalled();
    expect(llamaCppSessions.has("ckpt-shifted")).toBe(false);
  });

  it("returns undefined from capture (and false from restore) when the rewind API is missing", async () => {
    const bareSequence = { dispose: vi.fn(async () => {}) };
    expect(captureSequenceTokenBoundary(bareSequence)).toBeUndefined();

    const { state } = makeState(bareSequence);
    const restored = await restoreLlamaCppCheckpointSession("ckpt-bare", state, undefined, []);
    expect(restored).toBe(false);
    expect(llamaCppSessions.has("ckpt-bare")).toBe(false);
  });
});
