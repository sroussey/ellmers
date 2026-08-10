/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_LIMITS, getLogger } from "@workglow/util";
import type { TaskGraph } from "./TaskGraph";

/**
 * Symbol-keyed marker we attach to each subgraph so nested calls can derive
 * the current depth from the parent without changing call sites. Stored on a
 * symbol to avoid colliding with any user-set property.
 */
const BRIDGE_DEPTH = Symbol.for("@workglow/task-graph/SubGraphEventBridge.depth");

/**
 * Track parent graphs that have already emitted the depth-cap warning so a
 * pathologically nested compound (e.g. an iterator with 1k iterations all at
 * over-cap) does not spam one warn per iteration. Held weakly so an evicted
 * parent graph can still be garbage-collected.
 */
const warnedParents = new WeakSet<TaskGraph>();

/**
 * Forward a subgraph's per-task events (task_complete, task_progress, task_usage,
 * and the task_stream_* trio) up to the parent graph, so tasks nested inside a
 * compound task (GraphAsTask / FallbackTask / WhileTask / ...) surface as individual
 * task events on the top-level run stream — used by consumers for live previews
 * and progress. Bubbles recursively: a nested compound forwards its own
 * subgraph to its parent, which forwards onward.
 *
 * Depth is tracked on the parent graph via a symbol-keyed marker so callers do
 * not need to thread a counter through. Once `depth >= maxDepth` the call
 * degrades to a no-op (with a single warn log) — see
 * {@link DEFAULT_LIMITS.bridgeMaxDepth}. Each level installs one listener per
 * event type and re-emits up; without a cap, a pathologically nested compound
 * task (e.g. a MapTask containing a GraphAsTask containing a MapTask…)
 * amplifies a single inner emit into N parent emits before reaching any wire
 * subscriber, and downstream consumers with a bounded event log can evict
 * legitimate events under sustained fan-out.
 *
 * @returns a teardown that unsubscribes every bridged listener. Callers MUST
 *   invoke it in a `finally` so a rejecting/aborted/early-terminated subgraph
 *   run cannot leak subscriptions (which would double-emit on a later run).
 */
export function bridgeSubGraphTaskEvents(
  subGraph: TaskGraph,
  parentGraph: TaskGraph,
  depth: number = (parentGraph as unknown as Record<symbol, number>)[BRIDGE_DEPTH] ?? 0,
  maxDepth: number = DEFAULT_LIMITS.bridgeMaxDepth
): () => void {
  // A subgraph bridging to itself would re-emit each event back onto the same
  // graph it just observed, looping forever. This cannot arise from normal
  // composition (a compound task's subGraph and parentGraph are distinct
  // instances) but guard anyway so a malformed hierarchy degrades to a no-op.
  if (subGraph === parentGraph) return () => {};

  // Capture the subgraph's prior depth marker up front so BOTH the over-cap and
  // the active-bridge paths can restore it on teardown. Restoring is what keeps
  // a later, independently-rooted bridge of the same (reused) subgraph instance
  // from inheriting a stale counter.
  const subGraphWithDepth = subGraph as unknown as Record<symbol, number>;
  const previousDepth = subGraphWithDepth[BRIDGE_DEPTH];
  const restoreDepth = () => {
    if (previousDepth === undefined) {
      delete subGraphWithDepth[BRIDGE_DEPTH];
    } else {
      subGraphWithDepth[BRIDGE_DEPTH] = previousDepth;
    }
  };

  if (depth >= maxDepth) {
    // Stamp the subgraph at the cap so any nested bridge call (whose
    // parentGraph is this subgraph) derives `depth >= maxDepth` and also
    // short-circuits — otherwise the depth counter resets at the next level
    // and the cap leaks downstream. The teardown restores the prior marker so
    // the stamp does not persist past this bridge's lifetime on a reused
    // subgraph instance.
    subGraphWithDepth[BRIDGE_DEPTH] = maxDepth;
    if (!warnedParents.has(parentGraph)) {
      warnedParents.add(parentGraph);
      getLogger().warn("bridgeSubGraphTaskEvents depth cap hit; dropping bridge", {
        depth,
        maxDepth,
      });
    }
    return restoreDepth;
  }

  // Stamp the subgraph with its bridge depth so any nested bridge call (whose
  // parentGraph is this subgraph) derives `depth + 1` automatically.
  subGraphWithDepth[BRIDGE_DEPTH] = depth + 1;

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
    subGraph.subscribe("task_usage", (id, usage, modelId) =>
      parentGraph.emit("task_usage", id, usage, modelId)
    ),
  ];
  return () => {
    offs.forEach((off) => off());
    // Restore the previous depth marker so a later, independently-rooted bridge
    // of the same subgraph instance does not inherit a stale counter.
    restoreDepth();
  };
}
