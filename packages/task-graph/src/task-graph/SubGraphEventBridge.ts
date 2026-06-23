/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraph } from "./TaskGraph";

/**
 * Forward a subgraph's per-task events (task_complete, task_progress, and the
 * task_stream_* trio) up to the parent graph, so tasks nested inside a compound
 * task (GraphAsTask / FallbackTask / WhileTask / ...) surface as individual
 * task events on the top-level run stream — used by consumers for live previews
 * and progress. Bubbles recursively: a nested compound forwards its own
 * subgraph to its parent, which forwards onward.
 *
 * @returns a teardown that unsubscribes every bridged listener. Callers MUST
 *   invoke it in a `finally` so a rejecting/aborted/early-terminated subgraph
 *   run cannot leak subscriptions (which would double-emit on a later run).
 */
export function bridgeSubGraphTaskEvents(subGraph: TaskGraph, parentGraph: TaskGraph): () => void {
  const offs = [
    subGraph.subscribe("task_complete", (id, out) => parentGraph.emit("task_complete", id, out)),
    subGraph.subscribe("task_progress", (id, p, m, ...a) =>
      parentGraph.emit("task_progress", id, p, m, ...a)
    ),
    subGraph.subscribe("task_stream_start", (id) => parentGraph.emit("task_stream_start", id)),
    subGraph.subscribe("task_stream_chunk", (id, ev) =>
      parentGraph.emit("task_stream_chunk", id, ev)
    ),
    subGraph.subscribe("task_stream_end", (id, out) =>
      parentGraph.emit("task_stream_end", id, out)
    ),
  ];
  return () => offs.forEach((off) => off());
}
