/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiEmit, AiJobInput, IAiExecutionStrategy } from "@workglow/ai";
import { runWithIterable } from "@workglow/ai";
import type { IExecuteContext, StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

interface CapturedRun {
  signal: AbortSignal;
  emit: AiEmit<TaskOutput>;
  /** Resolves the strategy's `execute()` promise (use to simulate normal completion). */
  resolveRun: () => void;
  /** Resolves once the strategy has been entered (so the test knows abort can fire). */
  entered: Promise<void>;
}

function createCapturingStrategy(): { strategy: IAiExecutionStrategy; runs: CapturedRun[] } {
  const runs: CapturedRun[] = [];
  const strategy: IAiExecutionStrategy = {
    async execute(_jobInput, context, _runnerId, emit) {
      let resolve!: () => void;
      const blocker = new Promise<void>((r) => {
        resolve = r;
      });
      let enteredResolver: (() => void) | undefined;
      const entered = new Promise<void>((r) => (enteredResolver = r));
      runs.push({ signal: context.signal, emit, resolveRun: resolve, entered });
      enteredResolver?.();
      // Emit one event so the consumer can `break`.
      emit({ type: "text-delta", port: "text", textDelta: "x" } as StreamEvent<TaskOutput>);
      // Block until either the test resolves us OR the signal aborts.
      await Promise.race([
        blocker,
        new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        }),
      ]);
    },
    abort() {},
  };
  return { strategy, runs };
}

function makeContext(parentSignal?: AbortSignal): IExecuteContext {
  return {
    signal: parentSignal ?? new AbortController().signal,
    updateProgress: async () => {},
    own: ((t: unknown) => t) as IExecuteContext["own"],
    disown: () => {},
    registry: undefined as unknown as IExecuteContext["registry"],
  };
}

// Minimal fake job input. `runWithIterable` only forwards this to the
// strategy under test, which ignores it — we just need the shape to satisfy
// `AiJobInput<TaskInput>` so the call site type-checks.
const fakeJobInput: AiJobInput<TaskInput> = {
  taskType: "Test",
  requires: [],
  aiProvider: "fake",
  taskInput: {
    model: { provider: "fake", provider_config: {} },
  },
};

describe("runWithIterable consumer abort propagation", () => {
  it("aborts the strategy signal when the consumer breaks out", async () => {
    const { strategy, runs } = createCapturingStrategy();
    const context = makeContext();

    const iterable = runWithIterable<TaskOutput>(
      strategy,
      fakeJobInput,
      context,
      undefined,
      (queue) => (event) => queue.push(event as StreamEvent<TaskOutput>)
    );

    let firstEvent: StreamEvent<TaskOutput> | undefined;
    for await (const event of iterable) {
      firstEvent = event;
      break; // Consumer-side abort: this is the trigger we want to verify.
    }

    expect(firstEvent?.type).toBe("text-delta");
    // Wait microtasks for the finally block in runWithIterable to fire.
    await Promise.resolve();
    expect(runs.length).toBe(1);
    expect(runs[0]?.signal.aborted).toBe(true);
  });

  it("aborts the strategy when the parent context signal aborts", async () => {
    const { strategy, runs } = createCapturingStrategy();
    const parent = new AbortController();
    const context = makeContext(parent.signal);

    const iterable = runWithIterable<TaskOutput>(
      strategy,
      fakeJobInput,
      context,
      undefined,
      (queue) => (event) => queue.push(event as StreamEvent<TaskOutput>)
    );

    const collected: StreamEvent<TaskOutput>[] = [];
    const consumer = (async () => {
      try {
        for await (const event of iterable) {
          collected.push(event);
          if (collected.length === 1) {
            // Trigger parent abort after the first event.
            parent.abort();
          }
        }
      } catch {
        // Expected — the queue.fail bubbles a rejection up.
      }
    })();
    await consumer;

    expect(runs.length).toBe(1);
    expect(runs[0]?.signal.aborted).toBe(true);
  });

  it("settles cleanly when the run-fn completes normally", async () => {
    const { strategy, runs } = createCapturingStrategy();
    const context = makeContext();

    const iterable = runWithIterable<TaskOutput>(
      strategy,
      fakeJobInput,
      context,
      undefined,
      (queue) => (event) => queue.push(event as StreamEvent<TaskOutput>)
    );

    // Consume until the run-fn is unblocked, then drain.
    const events: StreamEvent<TaskOutput>[] = [];
    const consumer = (async () => {
      for await (const event of iterable) {
        events.push(event);
        if (events.length === 1) {
          await runs[0]?.entered;
          runs[0]?.resolveRun();
        }
      }
    })();
    await consumer;

    // Normal completion: parent signal must remain intact even though
    // localAbort fires on the finally-block exit path.
    expect(context.signal.aborted).toBe(false);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("hands the strategy a stable wrapper context (WeakMap-keyed identity is consistent)", async () => {
    // Replacing the Proxy with a shallow clone gives the
    // strategy a single stable object reference, so a WeakMap keyed on the
    // `localContext` it sees observes the same identity for repeated reads.
    const seenContexts: unknown[] = [];
    const strategy: IAiExecutionStrategy = {
      async execute(_jobInput, context, _runnerId, emit) {
        seenContexts.push(context);
        seenContexts.push(context); // same reference both times
        emit({ type: "finish", data: {} } as StreamEvent<TaskOutput>);
      },
      abort() {},
    };

    const context = makeContext();
    const iterable = runWithIterable<TaskOutput>(
      strategy,
      fakeJobInput,
      context,
      undefined,
      (queue) => (event) => queue.push(event as StreamEvent<TaskOutput>)
    );
    for await (const _event of iterable) {
      // drain
    }

    expect(seenContexts.length).toBe(2);
    expect(seenContexts[0]).toBe(seenContexts[1]);
    // The wrapper is NOT the original context (signal was substituted).
    expect(seenContexts[0]).not.toBe(context);
    // Use a WeakMap to confirm identity stability beyond `===`.
    const map = new WeakMap<object, string>();
    map.set(seenContexts[0] as object, "ok");
    expect(map.get(seenContexts[1] as object)).toBe("ok");
  });

  it("propagates localAbort via wrappedContext.signal", async () => {
    // Verifies that the shallow-cloned `wrappedContext.signal` is wired to
    // `localAbort`: aborting through the consumer-return path fires the
    // signal that the strategy received.
    let capturedSignal: AbortSignal | undefined;
    const strategy: IAiExecutionStrategy = {
      async execute(_jobInput, context, _runnerId, emit) {
        capturedSignal = context.signal;
        emit({ type: "text-delta", port: "text", textDelta: "x" } as StreamEvent<TaskOutput>);
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        });
      },
      abort() {},
    };

    const context = makeContext();
    const iterable = runWithIterable<TaskOutput>(
      strategy,
      fakeJobInput,
      context,
      undefined,
      (queue) => (event) => queue.push(event as StreamEvent<TaskOutput>)
    );

    for await (const _event of iterable) {
      break; // triggers localAbort
    }
    await Promise.resolve();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
    // Parent untouched.
    expect(context.signal.aborted).toBe(false);
  });
});
