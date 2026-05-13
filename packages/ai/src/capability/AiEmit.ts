/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent, TaskOutput } from "@workglow/task-graph";

/**
 * Callback the dispatch layer hands to a run-fn so the run-fn can emit
 * in-flight stream events without ever returning them as a materialized
 * value. Output for one-shot capabilities rides on a single `finish` event;
 * output for streaming capabilities rides on the preceding `text-delta` /
 * `object-delta` / `snapshot` events with a trailing empty `finish`. The
 * accumulator that materializes a single `O` lives only at terminal
 * consumer sites ({@link AiTask.execute}, {@link StreamProcessor}'s
 * `ctx.shouldAccumulate` branch).
 *
 * Return type is `void | Promise<void>`. Sites that bridge into a bounded
 * {@link createEmitQueue} pass through that queue's `push()` return value:
 * producers that `await emit(...)` get backpressure for free. Producers
 * that don't `await` still work because events are buffered — they just
 * miss the signal. Synchronous consumers (e.g. {@link accumulatingEmit})
 * always return `void`.
 */
export type AiEmit<O extends TaskOutput = TaskOutput> = (
  event: StreamEvent<O>
) => void | Promise<void>;

/**
 * Discards every event. Used by callers that don't need mid-stream events
 * but still want to drive a run-fn to completion. Synchronous — has nothing
 * to backpressure on.
 */
export const noopEmit: AiEmit = () => {};
