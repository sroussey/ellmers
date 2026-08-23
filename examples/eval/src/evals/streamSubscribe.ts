/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent, TaskIdType, Workflow } from "@workglow/task-graph";
import type { RowOwner } from "./types";

/**
 * Run a workflow, forwarding its `stream_chunk` events to `onStreamChunk` for
 * the duration of the run only.
 *
 * When no listener is given, nothing is subscribed at all — a 500-row sweep
 * without `--stream` pays nothing for it.
 */
export async function runWithStreamChunks<Output>(
  workflow: Workflow,
  onStreamChunk: ((event: StreamEvent) => void) | undefined,
  owner?: RowOwner | undefined
): Promise<Output> {
  const listener = onStreamChunk
    ? (_taskId: TaskIdType, event: StreamEvent): void => onStreamChunk(event)
    : undefined;
  if (listener) workflow.on("stream_chunk", listener);
  // Owned for the row's duration, so the run stays ONE graph and the row is
  // visible while it runs. Disowned in `finally` rather than left attached: a
  // sweep is thousands of rows, and keeping every finished one would grow the
  // subgraph — and the console's row list — without bound.
  if (owner) owner.context.own(workflow, { title: owner.title });
  try {
    return (await workflow.run()) as Output;
  } finally {
    if (owner) owner.context.disown(workflow);
    if (listener) workflow.off("stream_chunk", listener);
  }
}
