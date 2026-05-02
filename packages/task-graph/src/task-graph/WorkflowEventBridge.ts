/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter } from "@workglow/util";
import type { TaskGraph } from "./TaskGraph";
import type { WorkflowEventListeners } from "./Workflow";

/**
 * Routes TaskGraph mutation events, entitlement updates, and per-run streaming
 * events to a Workflow's EventEmitter. Owns subscription lifecycle:
 *   attach(graph)   → subscribe to mutation + entitlement events
 *   detach()        → unsubscribe (called on graph swap and reset)
 *   beginRun()      → subscribe to streaming events for the current run
 *   endRun()        → unsubscribe streaming
 *
 * The bridge does NOT own the events emitter — the facade Workflow does. The
 * bridge holds a reference and emits through it.
 *
 * Loop-builder Workflows do NOT receive a bridge (matches today's behavior:
 * Workflow.ts only constructs a bridge when `parent` is undefined).
 */
export class WorkflowEventBridge {
  private readonly _events: EventEmitter<WorkflowEventListeners>;
  private _attachedGraph?: TaskGraph;
  private _entitlementUnsub?: () => void;
  private _streamingUnsub?: () => void;
  private readonly _onChanged: (id: unknown) => void;

  constructor(events: EventEmitter<WorkflowEventListeners>) {
    this._events = events;
    this._onChanged = (id) => this._events.emit("changed", id);
  }

  public attach(graph: TaskGraph): void {
    if (this._attachedGraph) this.detach();
    this._attachedGraph = graph;
    graph.on("task_added", this._onChanged);
    graph.on("task_replaced", this._onChanged);
    graph.on("task_removed", this._onChanged);
    graph.on("dataflow_added", this._onChanged);
    graph.on("dataflow_replaced", this._onChanged);
    graph.on("dataflow_removed", this._onChanged);
    this._entitlementUnsub = graph.subscribeToTaskEntitlements((entitlements) =>
      this._events.emit("entitlementChange", entitlements)
    );
  }

  public detach(): void {
    const graph = this._attachedGraph;
    if (!graph) return;
    graph.off("task_added", this._onChanged);
    graph.off("task_replaced", this._onChanged);
    graph.off("task_removed", this._onChanged);
    graph.off("dataflow_added", this._onChanged);
    graph.off("dataflow_replaced", this._onChanged);
    graph.off("dataflow_removed", this._onChanged);
    this._entitlementUnsub?.();
    this._entitlementUnsub = undefined;
    // Tear down any streaming subscription that's still tied to this graph.
    // Without this, a graph swap or reset() during a run would leave the old
    // graph's streaming handlers wired to this workflow's events emitter.
    this._streamingUnsub?.();
    this._streamingUnsub = undefined;
    this._attachedGraph = undefined;
  }

  public beginRun(): void {
    const graph = this._attachedGraph;
    if (!graph) return;
    this._streamingUnsub = graph.subscribeToTaskStreaming({
      onStreamStart: (taskId) => this._events.emit("stream_start", taskId),
      onStreamChunk: (taskId, event) => this._events.emit("stream_chunk", taskId, event),
      onStreamEnd: (taskId, output) => this._events.emit("stream_end", taskId, output),
    });
  }

  public endRun(): void {
    this._streamingUnsub?.();
    this._streamingUnsub = undefined;
  }
}
