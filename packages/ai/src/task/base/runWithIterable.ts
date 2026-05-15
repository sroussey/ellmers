/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { AiEmit } from "../../capability/AiEmit";
import type { EmitQueue } from "../../capability/emitQueue";
import { createEmitQueue } from "../../capability/emitQueue";
import type { IAiExecutionStrategy } from "../../execution/IAiExecutionStrategy";
import type { AiJobInput } from "../../job/AiJob";

/**
 * Factory for the emit callback that producers should use. Receives the
 * queue (already wired) and must return the function the strategy will
 * call when emitting events. Sites that need to peek at events before they
 * reach the consumer (e.g. AiChatTask accumulates a per-turn text and
 * swallows inner-turn `finish` events) use this hook; sites that don't
 * just `return (event) => queue.push(event as StreamEvent<Output>)`.
 */
export type RunWithIterableEmitFactory<Output extends TaskOutput> = (
  queue: EmitQueue<StreamEvent<Output>>
) => AiEmit<Output>;

/**
 * Drive a strategy through an emit-queue and surface its events as an
 * `AsyncIterable<StreamEvent<Output>>`. Centralises the abort plumbing
 * shared by every streaming task site:
 *
 *   1. Construct a `localAbort` AbortController.
 *   2. If `context.signal` is already aborted, abort `localAbort` synchronously
 *      so the strategy sees the cancellation on its first signal check.
 *      Otherwise wire a `once: true` listener that mirrors parent aborts
 *      into `localAbort`. The listener is removed when the run settles.
 *   3. Build a shallow-cloned context with `signal` replaced (other context
 *      fields pass through unchanged by reference) and hand that to
 *      `strategy.execute`. A shallow clone — rather than a `Proxy` — is used
 *      so the wrapper has a stable identity for callers that rely on
 *      reference equality (e.g. `WeakMap`-keyed caches).
 *   4. Iterate the queue and yield events to the caller.
 *   5. In a `finally`, abort `localAbort`, fail the queue, and await the
 *      run promise. The `await` swallows the post-abort rejection — the
 *      caller's iteration error (if any) is preserved by the surrounding
 *      try/finally semantics.
 *
 * Abort bond is strictly one-way: parent → child.
 *  • context.signal.abort() → localAbort aborts → strategy sees it.
 *  • localAbort.abort() (from the finally) does NOT abort the parent;
 *    the parent's signal is untouched and its other consumers keep running.
 *
 * @example
 *   // Cancellation is driven through an AbortController — AbortSignal has
 *   // no public .abort() method, so callers must keep the controller in
 *   // scope and call abort() on it (not on the signal).
 *   const parentController = new AbortController();
 *   const ctx: IExecuteContext = { ...baseContext, signal: parentController.signal };
 *
 *   const iter = runWithIterable(strategy, jobInput, ctx, runnerId, emitFactory);
 *
 *   // Parent cancels: both ctx.signal and the strategy stop.
 *   parentController.abort();
 *
 *   // Consumer break: only the strategy stops. parentController.signal
 *   // remains un-aborted and sibling tasks continue.
 *   for await (const e of iter) { if (done) break; }
 */
export async function* runWithIterable<Output extends TaskOutput>(
  strategy: IAiExecutionStrategy,
  jobInput: AiJobInput<TaskInput>,
  context: IExecuteContext,
  runnerId: string | undefined,
  emitFactory: RunWithIterableEmitFactory<Output>
): AsyncIterable<StreamEvent<Output>> {
  const queue = createEmitQueue<StreamEvent<Output>>();
  const localAbort = new AbortController();

  // Mirror parent aborts onto our localAbort. If the parent is already
  // aborted, abort synchronously — `addEventListener` on an aborted signal
  // never fires.
  const parentSignal: AbortSignal | undefined = context.signal;
  let parentCleanup: (() => void) | undefined;
  if (parentSignal) {
    if (parentSignal.aborted) {
      localAbort.abort(parentSignal.reason);
    } else {
      const onParentAbort = () => localAbort.abort(parentSignal.reason);
      // One-way bond: parent → child only. We never call parentSignal-side abort().
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
      parentCleanup = () => parentSignal.removeEventListener("abort", onParentAbort);
    }
  }

  // The strategy reads `signal` off the context; substitute our local one.
  // Keep every other field (own, registry, updateProgress, resourceScope,
  // inputStreams, …) referentially identical so behaviour outside cancel
  // semantics is unchanged. A shallow clone (rather than a Proxy) is used so
  // callers that rely on stable object identity (e.g. WeakMap-keyed caches
  // that key on the wrapped value rather than the original `context`) see a
  // single stable wrapper rather than a transparently-proxied view that
  // bypasses identity checks for non-`signal` keys.
  const wrappedContext: IExecuteContext = { ...context, signal: localAbort.signal };

  const emit = emitFactory(queue);
  const runPromise = strategy
    .execute(jobInput, wrappedContext, runnerId, emit as AiEmit<TaskOutput>)
    .then(
      () => queue.close(),
      (err) => queue.fail(err)
    );

  try {
    for await (const event of queue.iterable) {
      yield event;
    }
    // Stream drained normally — surface any error the run-fn raised after
    // queue.close()/queue.fail() (no-op when it resolved cleanly).
    await runPromise;
  } finally {
    // Consumer stopped iterating (break / return / throw / completion).
    // Abort the run, then drain the run-fn so we never leak a dangling
    // promise. Swallow the expected abort rejection.
    localAbort.abort(new DOMException("consumer-return", "AbortError"));
    queue.fail(new DOMException("consumer-return", "AbortError"));
    try {
      await runPromise;
    } catch {
      // Ignore: abort path always rejects, and the producer-visible
      // failure has already surfaced via the queue.
    }
    parentCleanup?.();
  }
}
