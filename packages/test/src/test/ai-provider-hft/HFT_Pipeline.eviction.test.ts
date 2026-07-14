/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  acquireHftPipelineInUse,
  hasCachedPipeline,
  isHftPipelineInUse,
  MAX_CACHED_PIPELINES,
  pipelines,
  releaseHftPipelineInUse,
  removeCachedPipeline,
  withHftPipelineInUse,
} from "@workglow/huggingface-transformers/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A pipeline for cache tests only needs the shape that `removeCachedPipeline`
 * reaches into — `model.dispose()`. `pipelines.set` accepts `unknown`-shaped
 * pipelines because the underlying map values are typed by the transformers
 * SDK's `Awaited<ReturnType<pipeline>>`; we cast at insertion.
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
 * Force LRU eviction by pushing the cache over cap and disposing the LRU
 * candidate. This mirrors the housekeeping path in `getPipeline` (which
 * runs `enforcePipelineCacheCap` after storing a fresh pipeline) so the
 * test suite exercises the public shape without needing to load a real
 * pipeline.
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

describe("withHftPipelineInUse", () => {
  afterEach(() => {
    pipelines.clear();
  });

  it("acquires and releases the refcount around the callback", async () => {
    const key = "test:acquire-release";
    expect(isHftPipelineInUse(key)).toBe(false);

    let sawInUseDuringCallback = false;
    await withHftPipelineInUse(key, async () => {
      sawInUseDuringCallback = isHftPipelineInUse(key);
    });

    expect(sawInUseDuringCallback).toBe(true);
    expect(isHftPipelineInUse(key)).toBe(false);
  });

  it("releases the refcount even when the callback throws", async () => {
    const key = "test:release-on-throw";
    await expect(
      withHftPipelineInUse(key, async () => {
        expect(isHftPipelineInUse(key)).toBe(true);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(isHftPipelineInUse(key)).toBe(false);
  });
});

describe("removeCachedPipeline in-use safety", () => {
  afterEach(() => {
    pipelines.clear();
  });

  it("skips disposal when the pipeline is in-use", async () => {
    const key = "test:in-use-skip";
    const dispose = seedPipeline(key);

    acquireHftPipelineInUse(key);
    try {
      const removed = await removeCachedPipeline(key);
      expect(removed).toBe(false);
      expect(dispose).not.toHaveBeenCalled();
      expect(hasCachedPipeline(key)).toBe(true);
    } finally {
      releaseHftPipelineInUse(key);
    }

    // Once released, disposal proceeds normally.
    const removedAfter = await removeCachedPipeline(key);
    expect(removedAfter).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(hasCachedPipeline(key)).toBe(false);
  });
});

describe("bounded LRU cache", () => {
  afterEach(() => {
    pipelines.clear();
  });

  it("evicts the least-recently-used non-in-use entry when over cap", async () => {
    // Seed exactly at cap.
    const disposeFns = new Map<string, ReturnType<typeof vi.fn>>();
    for (let i = 0; i < MAX_CACHED_PIPELINES; i++) {
      const key = `test:lru:${i}`;
      disposeFns.set(key, seedPipeline(key));
    }

    // Adding one more pushes the cache over cap.
    const freshKey = "test:lru:fresh";
    disposeFns.set(freshKey, seedPipeline(freshKey));

    const evicted = await evictUntilAtCap(freshKey);

    // The first-seeded key (insertion-order LRU) should be the sole eviction.
    const expectedEvictKey = "test:lru:0";
    expect(evicted).toEqual([expectedEvictKey]);
    expect(disposeFns.get(expectedEvictKey)!).toHaveBeenCalledTimes(1);
    expect(hasCachedPipeline(expectedEvictKey)).toBe(false);

    // Freshly loaded pipeline must survive.
    expect(hasCachedPipeline(freshKey)).toBe(true);
    expect(disposeFns.get(freshKey)!).not.toHaveBeenCalled();

    expect(pipelines.size).toBe(MAX_CACHED_PIPELINES);
  });

  it("skips an in-use entry and evicts the next LRU candidate", async () => {
    // Seed to cap.
    const disposeFns = new Map<string, ReturnType<typeof vi.fn>>();
    for (let i = 0; i < MAX_CACHED_PIPELINES; i++) {
      const key = `test:lru-inuse:${i}`;
      disposeFns.set(key, seedPipeline(key));
    }

    // Pin the LRU (first-seeded) key as in-use so eviction must skip it.
    const pinnedKey = "test:lru-inuse:0";
    const survivorKey = "test:lru-inuse:1";
    acquireHftPipelineInUse(pinnedKey);

    try {
      const freshKey = "test:lru-inuse:fresh";
      disposeFns.set(freshKey, seedPipeline(freshKey));

      const evicted = await evictUntilAtCap(freshKey);

      // The second-oldest (non-pinned) entry should be evicted instead.
      expect(evicted).toEqual([survivorKey]);
      expect(disposeFns.get(survivorKey)!).toHaveBeenCalledTimes(1);
      expect(hasCachedPipeline(survivorKey)).toBe(false);

      // The pinned in-use entry must survive.
      expect(hasCachedPipeline(pinnedKey)).toBe(true);
      expect(disposeFns.get(pinnedKey)!).not.toHaveBeenCalled();

      // Freshly loaded pipeline must survive.
      expect(hasCachedPipeline(freshKey)).toBe(true);
    } finally {
      releaseHftPipelineInUse(pinnedKey);
    }
  });
});
