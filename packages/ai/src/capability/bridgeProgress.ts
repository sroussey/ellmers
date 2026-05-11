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
 * @param op  Operation that takes an `onProgress` callback and returns a Promise.
 * @returns   An async generator that yields phase events and returns the operation's result.
 */
export async function* bridgeProgress<T>(
  op: (onProgress: (progress: number, message?: string) => void) => Promise<T>
): AsyncGenerator<StreamPhase, T, void> {
  const queue: StreamPhase[] = [];
  let waker: (() => void) | undefined;
  const wake = (): void => {
    const r = waker;
    waker = undefined;
    r?.();
  };

  const onProgress = (progress: number, message?: string): void => {
    queue.push({ type: "phase", message: message ?? "", progress });
    wake();
  };

  let result: T | undefined;
  let error: unknown;
  let settled = false;

  const promise = op(onProgress).then(
    (r) => {
      result = r;
    },
    (e) => {
      error = e;
    }
  );
  void promise.finally(() => {
    settled = true;
    wake();
  });

  while (!settled || queue.length > 0) {
    while (queue.length > 0) {
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
}
