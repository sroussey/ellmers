/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiJobInput, AiProviderRunFn } from "@workglow/ai";
import { AiJob, getAiProviderRegistry } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { afterEach, describe, expect, it } from "vitest";

const PROVIDER = "TEST_AIJOB_MEMORY";

afterEach(() => {
  getAiProviderRegistry().unregisterProvider(PROVIDER);
});

function jobInput(): AiJobInput {
  return {
    taskType: "Mem",
    requires: ["text.generation"],
    aiProvider: PROVIDER,
    taskInput: { model: { provider: PROVIDER, provider_config: {} } as any },
  };
}

const rss = () =>
  typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().rss : 0;

describe("AiJob memory bound", () => {
  it("RSS stays bounded across 200 dispatch calls emitting 1000 deltas each", async () => {
    if (rss() === 0) {
      // No memoryUsage in this runtime — skip.
      return;
    }

    const runFn: AiProviderRunFn = async (_i, _m, _s, emit) => {
      for (let i = 0; i < 1000; i++) {
        emit({ type: "text-delta", port: "text", textDelta: "x" } as StreamEvent);
      }
      emit({ type: "finish", data: {} } as StreamEvent);
    };
    getAiProviderRegistry().registerRunFn(PROVIDER, {
      serves: ["text.generation"],
      runFn,
    });

    // Warm-up to settle JIT and initial allocations.
    for (let i = 0; i < 20; i++) {
      const job = new AiJob({ queueName: PROVIDER, input: jobInput() });
      await job.execute(
        jobInput(),
        { signal: new AbortController().signal, updateProgress: async () => {} },
        () => {}
      );
    }

    if (global.gc) global.gc();
    const baseline = rss();

    for (let i = 0; i < 200; i++) {
      const job = new AiJob({ queueName: PROVIDER, input: jobInput() });
      await job.execute(
        jobInput(),
        { signal: new AbortController().signal, updateProgress: async () => {} },
        () => {}
      );
    }

    if (global.gc) global.gc();
    const after = rss();
    const growthMB = (after - baseline) / (1024 * 1024);
    // Generous bound: under 50MB growth over 200 dispatches is "bounded."
    // True leaks under the previous shape grew RSS unboundedly with each call.
    expect(growthMB).toBeLessThan(50);
  }, 30_000);
});
