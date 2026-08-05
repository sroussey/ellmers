/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";
import type { StreamEvent } from "../task/StreamTypes";
import type { TaskEntitlements } from "../task/TaskEntitlements";
import type { TaskIdType } from "../task/TaskTypes";
import type { DataflowIdType } from "./Dataflow";

/**
 * Events that can be emitted by the TaskGraph
 */

export type TaskGraphStatusListeners = {
  graph_progress: (progress: number | undefined, message?: string, ...args: any[]) => void;
  start: () => void;
  complete: () => void;
  error: (error: Error) => void;
  abort: () => void;
  disabled: () => void;
  /** Fired when a task in the graph starts streaming */
  task_stream_start: (taskId: TaskIdType) => void;
  /** Fired for each stream chunk produced by a task in the graph */
  task_stream_chunk: (taskId: TaskIdType, event: StreamEvent) => void;
  /** Fired when a task in the graph finishes streaming */
  task_stream_end: (taskId: TaskIdType, output: Record<string, any>) => void;
  /**
   * Fired when any task in the graph completes successfully, carrying its
   * output. Mirrors `task_stream_end` but fires for every task — streaming or
   * not — so consumers can observe authoritative outputs incrementally rather
   * than only at graph completion.
   *
   * NOTE: the same `taskId` may legitimately fire more than once across a run.
   * While/Fallback/GraphAsTask reuse the same subGraph (and thus stable task
   * ids) across loop iterations, so each iteration re-emits task_complete for
   * the identical id. There is no iteration discriminator on this event;
   * consumers keying state by taskId should treat a later emit as the
   * authoritative overwrite for that task. (Iterator clones mint fresh ids per
   * iteration, so they are unaffected.)
   */
  task_complete: (taskId: TaskIdType, output: Record<string, any>) => void;
  /**
   * Fired with a single task's own progress (not the aggregate `graph_progress`)
   * whenever that task reports progress. Lets consumers observe per-task
   * progress — including tasks nested in subgraphs, which bridge it up.
   */
  task_progress: (
    taskId: TaskIdType,
    progress: number | undefined,
    message?: string,
    ...args: any[]
  ) => void;
  /** Fired when the aggregated entitlements of the graph change */
  entitlementChange: (entitlements: TaskEntitlements) => void;
};
export type TaskGraphStatusEvents = keyof TaskGraphStatusListeners;
export type TaskGraphStatusListener<Event extends TaskGraphStatusEvents> =
  TaskGraphStatusListeners[Event];
export type TaskGraphEventStatusParameters<Event extends TaskGraphStatusEvents> = EventParameters<
  TaskGraphStatusListeners,
  Event
>;

export type GraphEventDagListeners = {
  task_added: (taskId: TaskIdType) => void;
  task_removed: (taskId: TaskIdType) => void;
  task_replaced: (taskId: TaskIdType) => void;
  dataflow_added: (dataflowId: DataflowIdType) => void;
  dataflow_removed: (dataflowId: DataflowIdType) => void;
  dataflow_replaced: (dataflowId: DataflowIdType) => void;
};
export type GraphEventDagEvents = keyof GraphEventDagListeners;
export type GraphEventDagListener<Event extends GraphEventDagEvents> =
  GraphEventDagListeners[Event];
export type GraphEventDagParameters<Event extends GraphEventDagEvents> = EventParameters<
  GraphEventDagListeners,
  Event
>;

export type TaskGraphListeners = TaskGraphStatusListeners & GraphEventDagListeners;
export type TaskGraphEvents = keyof TaskGraphListeners;
export type TaskGraphEventListener<Event extends TaskGraphEvents> = TaskGraphListeners[Event];
export type TaskGraphEventParameters<Event extends TaskGraphEvents> = EventParameters<
  TaskGraphListeners,
  Event
>;

export const EventDagToTaskGraphMapping = {
  "node-added": "task_added",
  "node-removed": "task_removed",
  "node-replaced": "task_replaced",
  "edge-added": "dataflow_added",
  "edge-removed": "dataflow_removed",
  "edge-replaced": "dataflow_replaced",
} as const;

export const EventTaskGraphToDagMapping = {
  task_added: "node-added",
  task_removed: "node-removed",
  task_replaced: "node-replaced",
  dataflow_added: "edge-added",
  dataflow_removed: "edge-removed",
  dataflow_replaced: "edge-replaced",
} as const;
