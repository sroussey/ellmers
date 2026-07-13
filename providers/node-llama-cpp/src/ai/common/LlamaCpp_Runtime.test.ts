/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import type { LlamaContext, LlamaContextSequence } from "node-llama-cpp";
import { acquireContextSequence } from "./LlamaCpp_Runtime";

/**
 * A minimal stand-in for `LlamaContext` that models node-llama-cpp's
 * **asynchronous** sequence reclamation: `sequencesLeft` reports 0 while a
 * previously disposed sequence's id is still being pushed back into the pool
 * under the context lock, then flips positive after `reclaimAfter` macrotasks.
 * `getSequence()` throws "No sequences left" whenever it is called while the
 * pool is empty — exactly as the real context does.
 */
function makeFakeContext(reclaimAfter: number): {
  context: LlamaContext;
  getSequenceCalls: () => number;
} {
  let ticks = 0;
  let calls = 0;
  const tick = (): void => {
    ticks += 1;
  };
  // Advance a macrotask counter on every event-loop turn so `sequencesLeft`
  // becomes positive only after `reclaimAfter` yields, mimicking the deferred
  // lock-guarded reclaim.
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
    // No waiting, and getSequence called exactly once.
    expect(getSequenceCalls()).toBe(1);
  });

  it("waits for a deferred reclaim instead of throwing 'No sequences left'", async () => {
    // Pool is empty for the first few event-loop turns, then reclaimed — the
    // exact race that made the raw `context.getSequence()` throw on slow models.
    const { context, getSequenceCalls } = makeFakeContext(3);
    const seq = await acquireContextSequence(context);
    expect(seq).toBeDefined();
    // getSequence is only invoked once the pool is non-empty, so it never throws.
    expect(getSequenceCalls()).toBe(1);
  });
});
