/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import type { TaskGraph } from "../task-graph/TaskGraph";
import type { StreamEvent, Usage } from "./StreamTypes";
import type { TaskEntitlements } from "./TaskEntitlements";
import type { TaskAbortedError, TaskError } from "./TaskError";
import type { TaskStatus } from "./TaskTypes";

// ========================================================================
// Event Handling Types
// ========================================================================
/**
 * Event listeners for task lifecycle events
 */

export type TaskEventListeners = {
  /** Fired when a task starts execution */
  start: () => void;

  /** Fired when a task completes successfully */
  complete: () => void;

  /** Fired when a task is aborted */
  abort: (error: TaskAbortedError) => void;

  /** Fired when a task encounters an error */
  error: (error: TaskError) => void;

  /** Fired when a task is disabled */
  disabled: () => void;

  /** Fired when a task reports progress */
  progress: (progress: number | undefined, message?: string, ...args: any[]) => void;

  /**
   * Fired whenever the task's running token total changes, and once more at the
   * end. `usage` is cumulative for the whole task execution — monotonic, unlike
   * the per-model-call stream event it is derived from — so consumers replace
   * rather than accumulate. `modelId` is the model that produced this update, or
   * `undefined` when the provider did not name one.
   *
   * A charge that settles after the task finished (provider cache storage,
   * billed at disposal) re-emits the new cumulative total, so replace still
   * holds.
   */
  usage: (usage: Usage, modelId: string | undefined) => void;

  /**
   * Iterator tasks (MapTask, ReduceTask, etc.): a per-iteration subgraph run is starting.
   * Index is 0-based; iterationCount is total iterations for this run.
   * `subgraph` is the live clone for this iteration — UIs render its tasks as
   * ordinary rows rather than numbered placeholders.
   */
  iteration_start: (index: number, iterationCount: number, subgraph?: TaskGraph) => void;

  /**
   * Iterator tasks: a per-iteration subgraph run finished (success or failure — check task status).
   */
  iteration_complete: (index: number, iterationCount: number) => void;

  /**
   * Iterator tasks: progress inside the per-iteration cloned subgraph (0–100).
   * Does not update {@link Task#progress} on the parent — use for per-row UI without fighting concurrent map workers.
   * `subgraph` is the same live clone as {@link TaskEventListeners.iteration_start}, so a
   * listener that missed start can still attach the graph from a later progress event.
   */
  iteration_progress: (
    index: number,
    iterationCount: number,
    progress: number | undefined,
    message?: string,
    subgraph?: TaskGraph
  ) => void;

  /** Fired when a regenerative task regenerates its graph */
  regenerate: () => void;

  /** Fired when a task is reset to original state */
  reset: () => void;

  /** Fired when a task status is updated */
  status: (status: TaskStatus) => void;

  /** Fired when a task's input or output schema changes (for tasks with dynamic schemas) */
  schemaChange: (inputSchema?: DataPortSchema, outputSchema?: DataPortSchema) => void;

  /** Fired when a task's required entitlements change (for tasks with dynamic entitlements) */
  entitlementChange: (entitlements: TaskEntitlements) => void;

  /** Fired when a streaming task begins producing chunks */
  stream_start: () => void;

  /** Fired for each stream chunk produced by a streaming task */
  stream_chunk: (event: StreamEvent) => void;

  /** Fired when a streaming task finishes (carries final output) */
  stream_end: (output: Record<string, unknown>) => void;
};
/** Union type of all possible task event names */

export type TaskEvents = keyof TaskEventListeners;
/** Type for task event listener functions */

export type TaskEventListener<Event extends TaskEvents> = TaskEventListeners[Event];
/** Type for task event parameters */

export type TaskEventParameters<Event extends TaskEvents> = EventParameters<
  TaskEventListeners,
  Event
>;
