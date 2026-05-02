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

export interface PendingLoopConnect {
  readonly parent: ITask;
  readonly iteratorTask: ITask;
}

/**
 * Runs deferred auto-connect for a loop iterator task on the parent
 * workflow's graph. Extracted as a free function so it can be invoked
 * from both {@link LoopBuilderContext.autoConnectLoopTask} and from
 * the parent {@link Workflow}'s public delegate method (the parent is
 * not itself in loop-builder mode and has no context of its own).
 */
export function runLoopAutoConnect(parentGraph: TaskGraph, pending: PendingLoopConnect): void {
  const { parent, iteratorTask } = pending;
  if (parentGraph.getTargetDataflows(parent.id).length !== 0) return;

  const nodes = parentGraph.getTasks();
  const parentIndex = nodes.findIndex((n) => n.id === parent.id);
  const earlierTasks: ITask[] = [];
  for (let i = parentIndex - 1; i >= 0; i--) {
    earlierTasks.push(nodes[i]);
  }

  const result = autoConnect(parentGraph, parent, iteratorTask, { earlierTasks });
  if (result.error) {
    getLogger().error(result.error + " Task not added.");
    parentGraph.removeTask(iteratorTask.id);
  }
}

/**
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
   * subGraph. No-op on empty graphs.
   */
  public finalizeTemplate(childGraph: TaskGraph): void {
    if (childGraph.getTasks().length === 0) return;
    this.iteratorTask.subGraph = childGraph;
    this.iteratorTask.validateAcyclic();
  }

  /** Runs auto-connect for the pending loop connect (if any), then clears it. */
  public consumePendingConnect(): void {
    const pending = this.pendingLoopConnect;
    if (!pending) return;
    runLoopAutoConnect(this.parent.graph, pending);
    this.pendingLoopConnect = undefined;
  }

  /** Finalizes the template and returns the parent workflow. */
  public finalizeAndReturn(childGraph: TaskGraph): Workflow {
    this.finalizeTemplate(childGraph);
    this.consumePendingConnect();
    return this.parent;
  }
}
