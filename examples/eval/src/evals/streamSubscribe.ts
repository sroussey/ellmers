/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent, TaskIdType, Workflow } from "@workglow/task-graph";

/**
 * Run a workflow, forwarding its `stream_chunk` events to `onStreamChunk` for
 * the duration of the run only.
 *
 * When no listener is given, nothing is subscribed at all — a 500-row sweep
 * without `--stream` pays nothing for it.
 */
export async function runWithStreamChunks<Output>(
  workflow: Workflow,
  onStreamChunk: ((event: StreamEvent) => void) | undefined
): Promise<Output> {
  const listener = onStreamChunk
    ? (_taskId: TaskIdType, event: StreamEvent): void => onStreamChunk(event)
    : undefined;
  if (listener) workflow.on("stream_chunk", listener);
  try {
    return (await workflow.run()) as Output;
  } finally {
    if (listener) workflow.off("stream_chunk", listener);
  }
}
