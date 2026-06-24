/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
import type { GraphAsTask } from "../task/GraphAsTask";
import type { ITask } from "../task/ITask";
import { autoConnect } from "./autoConnect";
import type { TaskGraph } from "./TaskGraph";
import type { Workflow } from "./Workflow";

/**
 * @internal
 */
export interface PendingLoopConnect {
  readonly parent: ITask;
  readonly iteratorTask: ITask;
}

/**
 * @internal
 * Runs deferred auto-connect for a loop iterator task on the parent
 * workflow's graph. Extracted as a free function so it can be invoked
 * from both {@link LoopBuilderContext.consumePendingConnect} and from
 * the parent {@link Workflow}'s public delegate method (the parent is
 * not itself in loop-builder mode and has no context of its own).
 *
 * Returns the error message if auto-connect failed, otherwise undefined.
 * On failure the iterator task is removed from the parent graph; the
 * caller is responsible for surfacing the error onto the parent
 * workflow's `.error` (matches the non-loop auto-connect path).
 */
export function runLoopAutoConnect(
  parentGraph: TaskGraph,
  pending: PendingLoopConnect
): string | undefined {
  const { parent, iteratorTask } = pending;
  if (parentGraph.getTargetDataflows(parent.id).length !== 0) return undefined;

  const nodes = parentGraph.getTasks();
  const parentIndex = nodes.findIndex((n) => n.id === parent.id);
  const earlierTasks: ITask[] = [];
  for (let i = parentIndex - 1; i >= 0; i--) {
    earlierTasks.push(nodes[i]);
  }

  const result = autoConnect(parentGraph, parent, iteratorTask, { earlierTasks });
  if (result.error) {
    const message = result.error + " Task not added.";
    getLogger().error(message);
    parentGraph.removeTask(iteratorTask.id);
    return message;
  }
  return undefined;
}

/**
 * @internal
 * Holds the parent <-> child relationship for a Workflow operating in
 * loop-builder mode (created by parent.addLoopTask). Owns deferred
 * auto-connect state. Has no events, no DSL.
 */
export class LoopBuilderContext {
  public readonly parent: Workflow;
  public readonly iteratorTask: GraphAsTask;
  public pendingLoopConnect?: PendingLoopConnect;

  constructor(parent: Workflow, iteratorTask: GraphAsTask) {
    this.parent = parent;
    this.iteratorTask = iteratorTask;
  }

  /**
   * Promotes a populated child template graph into the iterator task's
   * subGraph. No-op on empty graphs (an empty loop body is almost certainly a
   * mistake — the iterator keeps its default/empty subGraph and the failure
   * surfaces later at run as iteration-over-nothing — so warn to make it
   * diagnosable at the point of the mistake).
   */
  public finalizeTemplate(childGraph: TaskGraph): void {
    if (childGraph.getTasks().length === 0) {
      getLogger().warn(
        `Loop body for iterator task ${this.iteratorTask.config.id} is empty; ` +
          "the loop has no tasks to iterate. Add at least one task inside the loop builder."
      );
      return;
    }
    this.iteratorTask.subGraph = childGraph;
    this.iteratorTask.validateAcyclic();
  }

  /**
   * Runs auto-connect for the pending loop connect (if any), then clears it.
   * Returns the error message if auto-connect failed, otherwise undefined,
   * so the caller can propagate the failure to the parent workflow's `.error`.
   */
  public consumePendingConnect(): string | undefined {
    const pending = this.pendingLoopConnect;
    if (!pending) return undefined;
    const error = runLoopAutoConnect(this.parent.graph, pending);
    this.pendingLoopConnect = undefined;
    return error;
  }

  /**
   * Finalizes the template and returns the parent workflow. Any deferred
   * auto-connect error is surfaced onto the parent's `.error` to match the
   * non-loop auto-connect path.
   */
  public finalizeAndReturn(childGraph: TaskGraph): Workflow {
    this.finalizeTemplate(childGraph);
    const error = this.consumePendingConnect();
    if (error) this.parent.builder.setError(error);
    return this.parent;
  }
}
