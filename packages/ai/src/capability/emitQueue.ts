/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bridge between a synchronous `push(event)` producer and a `for await ... of`
 * consumer. Used by {@link StreamingAiTask.executeStream} to forward events
 * from a Promise+emit run-fn to its `AsyncIterable<StreamEvent>` consumer
 * (StreamProcessor / task-graph runner).
 *
 * Holds at most the events buffered between an `emit()` and the next iteration
 * step — naturally bounded by consumer pacing. The queue does **not**
 * accumulate beyond that; if the consumer keeps up, the queue is essentially
 * empty at every step. This is not a buffer for materializing `O` — that lives
 * at terminal-consumer sites.
 *
 * Termination: `close()` ends the stream cleanly; `fail(err)` makes the next
 * iteration step `throw`. Both are idempotent — later pushes / closes / fails
 * after the first terminal signal are ignored.
 *
 * **Single-consumer.** The waker pattern stores at most one pending resolver,
 * so the `iterable` must be consumed by exactly one `for await` loop. Multiple
 * concurrent iterators are not supported and will hang. This matches the
 * intended use site ({@link StreamingAiTask.executeStream}, which iterates
 * once).
 */
export interface EmitQueue<E> {
  push(event: E): void;
  close(): void;
  fail(err: unknown): void;
  readonly iterable: AsyncIterable<E>;
}

export function createEmitQueue<E>(): EmitQueue<E> {
  type QueueItem =
    | { kind: "event"; data: E }
    | { kind: "done" }
    | { kind: "error"; error: unknown };

  const queue: QueueItem[] = [];
  let waiting: ((value: void) => void) | null = null;
  let terminated = false;

  const notify = () => {
    if (waiting) {
      const r = waiting;
      waiting = null;
      r();
    }
  };

  const push = (event: E) => {
    if (terminated) return;
    queue.push({ kind: "event", data: event });
    notify();
  };

  const close = () => {
    if (terminated) return;
    terminated = true;
    queue.push({ kind: "done" });
    notify();
  };

  const fail = (error: unknown) => {
    if (terminated) return;
    terminated = true;
    queue.push({ kind: "error", error });
    notify();
  };

  const iterable: AsyncIterable<E> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<E>> {
          while (true) {
            while (queue.length > 0) {
              const item = queue.shift()!;
              if (item.kind === "event") return { value: item.data, done: false };
              if (item.kind === "done") return { value: undefined, done: true };
              throw item.error;
            }
            await new Promise<void>((resolve) => {
              waiting = resolve;
            });
          }
        },
      };
    },
  };

  return { push, close, fail, iterable };
}
