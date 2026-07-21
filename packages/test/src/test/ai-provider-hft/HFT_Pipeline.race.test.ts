/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  clearPipelineCache,
  getHftSession,
  hasCachedPipeline,
  type HftPrefixRewindSession,
  isHftPipelineInUse,
  MAX_CACHED_PIPELINES,
  pipelines,
  removeCachedPipeline,
  setHftSession,
  withHftPipelineInUse,
} from "@workglow/huggingface-transformers/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Shape parity with the eviction test suite: `removeCachedPipeline` only
 * reaches into `pipeline.model.dispose`, so the fake pipeline only needs
 * that shape.
 */
function makeFakePipeline(): {
  pipeline: unknown;
  dispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn(async () => {});
  const pipeline = { model: { dispose } };
  return { pipeline, dispose };
}

function seedPipeline(cacheKey: string): ReturnType<typeof vi.fn> {
  const { pipeline, dispose } = makeFakePipeline();
  (pipelines as Map<string, unknown>).set(cacheKey, pipeline);
  return dispose;
}

/**
 * Drive the same LRU housekeeping loop that `enforcePipelineCacheCap`
 * runs after each successful pipeline load: iterate cached entries in
 * insertion (LRU) order, skip in-use candidates, dispose the first
 * evictable non-`exceptKey` entry, repeat until at or below cap.
 */
async function evictUntilAtCap(exceptKey: string): Promise<string[]> {
  const evicted: string[] = [];
  while (pipelines.size > MAX_CACHED_PIPELINES) {
    let picked: string | undefined;
    for (const key of pipelines.keys()) {
      if (key === exceptKey) continue;
      if (isHftPipelineInUse(key)) continue;
      picked = key;
      break;
    }
    if (picked === undefined) return evicted;
    const removed = await removeCachedPipeline(picked);
    if (!removed) return evicted;
    evicted.push(picked);
  }
  return evicted;
}

describe("H1: refcount before pipeline lookup", () => {
  afterEach(() => {
    pipelines.clear();
  });

  it("does not dispose a cache-hit pipeline while a caller awaits between lookup and refcount", async () => {
    // A caller acquires the refcount *before* looking up the pipeline (the
    // fixed pattern). A parallel loader fills the cache past cap and drives
    // the enforce-cap sweep. The in-use pipeline must survive.
    const inUseKey = "A";
    const dispose = seedPipeline(inUseKey);

    // Emulate the run-fn: acquire refcount, then look up. Between the two
    // awaits we run the LRU sweep on another task.
    let sawDisposeBeforeInference = false;
    const inference = withHftPipelineInUse(inUseKey, async () => {
      // "Lookup" happens after the refcount is held.
      const cached = pipelines.get(inUseKey);
      expect(cached).toBeDefined();

      // In the buggy version, a sibling loader that pushed the cache over
      // cap could dispose `inUseKey` here. Simulate that: fill to over cap,
      // run the eviction pass, and verify the in-use entry was skipped.
      for (let i = 0; i < MAX_CACHED_PIPELINES; i++) {
        seedPipeline(`filler:${i}`);
      }
      // Freshly loaded key is inserted last; the sweep picks LRU non-in-use.
      const freshKey = "filler:fresh";
      seedPipeline(freshKey);

      await evictUntilAtCap(freshKey);

      if (dispose.mock.calls.length > 0) {
        sawDisposeBeforeInference = true;
      }

      // "Inference" completes successfully with the still-cached pipeline.
      const stillCached = pipelines.get(inUseKey);
      expect(stillCached).toBeDefined();
    });

    await inference;

    expect(sawDisposeBeforeInference).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(hasCachedPipeline(inUseKey)).toBe(true);
  });

  it("concurrent inference across N run-fns never disposes an in-use pipeline", async () => {
    // Seed cap + 2 entries and pick two random keys to mark as in-use.
    const disposeFns = new Map<string, ReturnType<typeof vi.fn>>();
    for (let i = 0; i < MAX_CACHED_PIPELINES + 2; i++) {
      const key = `race:${i}`;
      disposeFns.set(key, seedPipeline(key));
    }

    // Randomize but keep the choice inside the seeded range.
    const seeded = Array.from(disposeFns.keys());
    const first = seeded[Math.floor(seeded.length * 0.3)];
    let second = seeded[Math.floor(seeded.length * 0.7)];
    if (second === first) second = seeded[(seeded.indexOf(first) + 1) % seeded.length];

    const inUseKeys = [first, second];

    // Hold both keys in-use for the duration of the sweep.
    await Promise.all(
      inUseKeys.map((key) =>
        withHftPipelineInUse(key, async () => {
          // Fresh load (last-inserted) is the exception; over-cap eviction
          // walks LRU order and must skip both in-use keys.
          const freshKey = seeded[seeded.length - 1];
          await evictUntilAtCap(freshKey);
          for (const inUse of inUseKeys) {
            expect(disposeFns.get(inUse)!).not.toHaveBeenCalled();
            expect(hasCachedPipeline(inUse)).toBe(true);
          }
        })
      )
    );

    // After release, all in-use entries survived (though other keys may
    // have been evicted to bring the cache back to cap).
    for (const inUse of inUseKeys) {
      expect(disposeFns.get(inUse)!).not.toHaveBeenCalled();
    }
  });
});

/**
 * Fake session tensor: `disposeSessionResources` only calls `dispose()` on
 * `HftPrefixRewindSession.baseEntries` values whose `location === "gpu-buffer"`.
 * A vi.fn() dispose lets the assertion check the sweep actually ran.
 */
function makeFakeSessionTensor(): {
  tensor: { location: "gpu-buffer"; dispose: ReturnType<typeof vi.fn> };
  dispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn();
  const tensor = { location: "gpu-buffer" as const, dispose };
  return { tensor, dispose };
}

function seedPrefixRewindSession(
  sessionId: string,
  modelPath: string,
  cacheKey: string
): ReturnType<typeof vi.fn> {
  const { tensor, dispose } = makeFakeSessionTensor();
  const session: HftPrefixRewindSession = {
    mode: "prefix-rewind",
    baseEntries: { "layer.0": tensor },
    baseSeqLength: 0,
    modelPath,
    cacheKey,
  };
  setHftSession(sessionId, session);
  return dispose;
}

describe("H1: LRU pipeline eviction sweeps hftSessions", () => {
  afterEach(async () => {
    await clearPipelineCache();
  });

  it("evicting a pipeline sweeps sessions tied to its cacheKey but not sibling variants", async () => {
    const evictedKey = "A:pipeline:q4:webgpu:main";
    const survivorKey = "A:pipeline:fp32:wasm:main";

    const evictedPipelineDispose = seedPipeline(evictedKey);
    seedPipeline(survivorKey);
    // Filler entries so the cache mirrors real conditions when eviction
    // fires — the sweep must not depend on any particular cache size.
    for (let i = 0; i < 2; i++) seedPipeline(`filler:${i}`);

    const evictedSessionId = "convo:1";
    const survivorSessionId = "convo:2";
    const evictedSessionDispose = seedPrefixRewindSession(evictedSessionId, "A/model", evictedKey);
    const survivorSessionDispose = seedPrefixRewindSession(
      survivorSessionId,
      "A/model",
      survivorKey
    );

    const removed = await removeCachedPipeline(evictedKey);

    expect(removed).toBe(true);
    expect(evictedPipelineDispose).toHaveBeenCalledTimes(1);

    // Evicted session gone with its tensors disposed.
    expect(getHftSession(evictedSessionId)).toBeUndefined();
    expect(evictedSessionDispose).toHaveBeenCalledTimes(1);

    // Sibling variant untouched: same model_path, different cacheKey.
    expect(getHftSession(survivorSessionId)).toBeDefined();
    expect(survivorSessionDispose).not.toHaveBeenCalled();
    expect(hasCachedPipeline(survivorKey)).toBe(true);
  });

  it("clearPipelineCache disposes every session", async () => {
    seedPipeline("K1");
    seedPipeline("K2");
    const sess1 = seedPrefixRewindSession("s1", "A/model", "K1");
    const sess2 = seedPrefixRewindSession("s2", "B/model", "K2");

    await clearPipelineCache();

    expect(sess1).toHaveBeenCalledTimes(1);
    expect(sess2).toHaveBeenCalledTimes(1);
    expect(getHftSession("s1")).toBeUndefined();
    expect(getHftSession("s2")).toBeUndefined();
    expect(pipelines.size).toBe(0);
  });
});
