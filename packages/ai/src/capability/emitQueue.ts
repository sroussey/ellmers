/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bridge between a `push(event)` producer and a `for await ... of` consumer.
 * Used by {@link StreamingAiTask.executeStream} and the chat tasks to
 * forward events from a Promise+emit run-fn to an
 * `AsyncIterable<StreamEvent>` consumer (StreamProcessor / task-graph
 * runner / our own per-turn loops).
 *
 * **Bounded.** The queue keeps a configurable `highWaterMark` /
 * `lowWaterMark` pair (defaults 256 / 64). When the buffered queue
 * reaches `highWaterMark` events, {@link EmitQueue.push} returns a
 * Promise instead of `void`; the promise resolves once iteration has
 * drained the queue back below `lowWaterMark`. Producers that don't
 * `await` continue to push — the queue still buffers — but they lose the
 * backpressure signal. Used by callers that want to slow down a fast
 * producer without dropping events.
 *
 * Termination: `close()` ends the stream cleanly; `fail(err)` makes the
 * next iteration step `throw`. Both are idempotent — later pushes /
 * closes / fails after the first terminal signal are ignored. Both also
 * release any pending drain-resolvers from `push()` so producers that
 * were awaiting backpressure don't leak.
 *
 * **Single-consumer.** The waker pattern stores at most one pending
 * resolver, so the `iterable` must be consumed by exactly one `for await`
 * loop. Multiple concurrent iterators are not supported and will hang.
 */
export interface EmitQueueOptions {
  /** Buffered events at or above this length cause `push()` to return a drain promise. Default 256. */
  highWaterMark?: number;
  /** Drain promises returned by `push()` resolve once the queue has drained below this length. Default 64. */
  lowWaterMark?: number;
}

export interface EmitQueue<E> {
  push(event: E): void | Promise<void>;
  close(): void;
  fail(err: unknown): void;
  readonly iterable: AsyncIterable<E>;
  /** Current number of buffered events. Exposed for tests / instrumentation. */
  readonly length: number;
}

export function createEmitQueue<E>(options: EmitQueueOptions = {}): EmitQueue<E> {
  const highWaterMark = options.highWaterMark ?? 256;
  const lowWaterMark = options.lowWaterMark ?? Math.max(1, Math.floor(highWaterMark / 4));
  if (lowWaterMark >= highWaterMark) {
    throw new RangeError(
      `emitQueue: lowWaterMark (${lowWaterMark}) must be < highWaterMark (${highWaterMark})`
    );
  }

  type QueueItem =
    | { kind: "event"; data: E }
    | { kind: "done" }
    | { kind: "error"; error: unknown };

  const queue: QueueItem[] = [];
  let waiting: ((value: void) => void) | null = null;
  let terminated = false;

  // Drain resolvers parked by `push()` when the queue is at/above the
  // high-water mark. Drained by `maybeDrain()` after each shift, or by
  // `close()` / `fail()`.
  const drainResolvers: (() => void)[] = [];

  const releaseDrainers = () => {
    while (drainResolvers.length > 0) {
      const r = drainResolvers.shift()!;
      r();
    }
  };

  const maybeDrain = () => {
    if (drainResolvers.length === 0) return;
    // Only the data-event count matters for backpressure; `done` and
    // `error` markers are tail-end markers that don't count against the
    // budget. But `queue.length` already overestimates if a terminator
    // is queued — which is fine, because once terminated we release every
    // pending drainer anyway.
    if (queue.length <= lowWaterMark) {
      releaseDrainers();
    }
  };

  const notify = () => {
    if (waiting) {
      const r = waiting;
      waiting = null;
      r();
    }
  };

  const push = (event: E): void | Promise<void> => {
    if (terminated) return;
    queue.push({ kind: "event", data: event });
    notify();
    if (queue.length >= highWaterMark) {
      return new Promise<void>((resolve) => {
        drainResolvers.push(resolve);
      });
    }
    return;
  };

  const close = () => {
    if (terminated) return;
    terminated = true;
    queue.push({ kind: "done" });
    notify();
    releaseDrainers();
  };

  const fail = (error: unknown) => {
    if (terminated) return;
    terminated = true;
    queue.push({ kind: "error", error });
    notify();
    releaseDrainers();
  };

  const iterable: AsyncIterable<E> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<E>> {
          while (true) {
            while (queue.length > 0) {
              const item = queue.shift()!;
              maybeDrain();
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

  return {
    push,
    close,
    fail,
    iterable,
    get length() {
      return queue.length;
    },
  };
}
