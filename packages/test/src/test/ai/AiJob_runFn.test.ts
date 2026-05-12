/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiJob, getAiProviderRegistry } from "@workglow/ai";
import type { AiProviderRunFn, AiJobInput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { afterEach, describe, expect, it } from "vitest";

const PROVIDER = "TEST_AIJOB_RUNFN";

afterEach(() => {
  getAiProviderRegistry().unregisterProvider(PROVIDER);
});

function makeJobInput(taskInput: Record<string, unknown>): AiJobInput {
  return {
    taskType: "Test",
    requires: ["text.generation"],
    aiProvider: PROVIDER,
    taskInput: {
      ...taskInput,
      model: { provider: PROVIDER, provider_config: {} } as any,
    } as any,
  };
}

describe("AiJob.execute (new shape)", () => {
  it("forwards emitted events to the caller-supplied emit", async () => {
    const reg = getAiProviderRegistry();
    const runFn: AiProviderRunFn = async (_i, _m, _s, emit) => {
      emit({ type: "phase", message: "go", progress: 0 } as StreamEvent);
      emit({ type: "finish", data: { ok: true } } as StreamEvent);
    };
    reg.registerRunFn(PROVIDER, { serves: ["text.generation"], runFn });

    const job = new AiJob({ queueName: PROVIDER, input: makeJobInput({}) });
    const events: StreamEvent[] = [];
    const ac = new AbortController();
    await job.execute(makeJobInput({}), { signal: ac.signal, updateProgress: async () => {} }, (e) =>
      events.push(e)
    );
    expect(events.map((e) => e.type)).toEqual(["phase", "finish"]);
  });

  it("rejects when the run-fn throws", async () => {
    const reg = getAiProviderRegistry();
    const runFn: AiProviderRunFn = async () => {
      throw new Error("boom");
    };
    reg.registerRunFn(PROVIDER, { serves: ["text.generation"], runFn });

    const job = new AiJob({ queueName: PROVIDER, input: makeJobInput({}) });
    const ac = new AbortController();
    await expect(
      job.execute(makeJobInput({}), { signal: ac.signal, updateProgress: async () => {} }, () => {})
    ).rejects.toThrow();
  });

  it("respects abort signal", async () => {
    const reg = getAiProviderRegistry();
    const runFn: AiProviderRunFn = async (_i, _m, signal) => {
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };
    reg.registerRunFn(PROVIDER, { serves: ["text.generation"], runFn });

    const job = new AiJob({ queueName: PROVIDER, input: makeJobInput({}) });
    const ac = new AbortController();
    const p = job.execute(
      makeJobInput({}),
      { signal: ac.signal, updateProgress: async () => {} },
      () => {}
    );
    queueMicrotask(() => ac.abort());
    await expect(p).rejects.toThrow();
  });
});
