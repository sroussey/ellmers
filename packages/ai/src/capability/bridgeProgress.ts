/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamPhase } from "@workglow/task-graph";

/**
 * Bridges a Promise-returning operation that reports progress via a callback
 * into an async generator yielding `phase` stream events. The generator's
 * return value is the resolved value of the underlying operation.
 *
 * Usage from inside an `AiProviderStreamFn`:
 *
 * ```ts
 * export const Foo: AiProviderStreamFn<I, O, M> = async function* (input, model, signal) {
 *   const pipeline = yield* bridgeProgress((onProgress) =>
 *     getPipeline(model!, onProgress, {}, signal)
 *   );
 *   const result = await pipeline(input.text);
 *   yield { type: "finish", data: { result } };
 * };
 * ```
 *
 * Every invocation of the `onProgress` callback inside `op` enqueues a
 * `{ type: "phase", message, progress }` event that the outer generator yields
 * on its next iteration. The `StreamProcessor` (consumer side) re-translates
 * each `phase` event into an `onProgress(percent, message)` call, so progress
 * propagates end-to-end from the SDK through the dataflow into the task's
 * progress listeners.
 *
 * **Memory note**: the body explicitly nulls every captured reference in
 * `finally`. The generator's frame survives until the consumer fully drains
 * it (after `for await ... break` the iterator's `.return()` runs the finally
 * block). Without these clears, the captured `op` closure transitively pins
 * the caller's `model`, `signal`, and resolved pipeline objects, which
 * compounds across tight-loop dispatch and was observed to cause a 7× WASM
 * heap regression under RAG load (see scratch/bridgeProgress-leak-repro.md).
 *
 * @param op  Operation that takes an `onProgress` callback and returns a Promise.
 * @returns   An async generator that yields phase events and returns the operation's result.
 */
export async function* bridgeProgress<T>(
  op: (onProgress: (progress: number, message?: string) => void) => Promise<T>
): AsyncGenerator<StreamPhase, T, void> {
  let queue: StreamPhase[] | undefined = [];
  let waker: (() => void) | undefined;
  let onProgress: ((progress: number, message?: string) => void) | undefined = (
    progress,
    message
  ) => {
    queue?.push({ type: "phase", message: message ?? "", progress });
    const r = waker;
    waker = undefined;
    r?.();
  };

  let result: T | undefined;
  let error: unknown;
  let settled = false;

  // Hold no reference to `op`'s returned promise beyond what's necessary for
  // the .then / .finally reactions. After both fire, the chained promise
  // becomes unreachable and its handlers (which close over result/error/
  // settled/waker) can be GC'd.
  let promise: Promise<unknown> | undefined = op(onProgress).then(
    (r) => {
      result = r;
    },
    (e) => {
      error = e;
    }
  );
  void promise.finally(() => {
    settled = true;
    const r = waker;
    waker = undefined;
    r?.();
  });

  try {
    while (!settled || (queue && queue.length > 0)) {
      while (queue && queue.length > 0) {
        yield queue.shift()!;
      }
      if (!settled) {
        await new Promise<void>((resolve) => {
          waker = resolve;
        });
      }
    }

    if (error) throw error;
    return result as T;
  } finally {
    // Explicitly null out every captured reference so the generator's frame
    // does not pin them past the consumer's break. The frame is finalized
    // when for-await calls .return() on iterator early-exit; clearing here
    // ensures that closure-captured `op`, the pipeline result, and the
    // promise reactions release immediately, not on V8's next major GC.
    queue = undefined;
    waker = undefined;
    onProgress = undefined;
    promise = undefined;
    result = undefined;
    error = undefined;
  }
}
