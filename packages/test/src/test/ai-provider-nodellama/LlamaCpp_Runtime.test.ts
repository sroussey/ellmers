/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { acquireContextSequence } from "@workglow/node-llama-cpp/ai-runtime";
import type { LlamaContext, LlamaContextSequence } from "node-llama-cpp";
import { describe, expect, it } from "vitest";

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
