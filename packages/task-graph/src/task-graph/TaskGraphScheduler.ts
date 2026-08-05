/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask } from "../task/ITask";
import { getPortStreamMode } from "../task/StreamTypes";
import { TaskStatus } from "../task/TaskTypes";
import type { TaskGraph } from "./TaskGraph";

/**
 * Interface for task graph schedulers
 */
export interface ITaskGraphScheduler {
  /**
   * Gets an async iterator of tasks that can be executed
   * @returns AsyncIterator of tasks that resolves to each task when it's ready
   */
  tasks(): AsyncIterableIterator<ITask>;

  /**
   * Notifies the scheduler that a task has completed
   * @param taskId The ID of the completed task
   */
  onTaskCompleted(taskId: unknown): void;

  /**
   * Notifies the scheduler that a task has begun streaming output.
   * Streaming tasks may unblock downstream streamable tasks early.
   * @param taskId The ID of the streaming task
   */
  onTaskStreaming(taskId: unknown): void;

  /**
   * Resets the scheduler state
   */
  reset(): void;
}

/**
 * Sequential scheduler that executes one task at a time in topological order
 * Useful for debugging and understanding task execution flow
 */
export class TopologicalScheduler implements ITaskGraphScheduler {
  private sortedNodes: ITask[];
  private currentIndex: number;

  constructor(private dag: TaskGraph) {
    this.sortedNodes = [];
    this.currentIndex = 0;
    this.reset();
  }

  async *tasks(): AsyncIterableIterator<ITask> {
    while (this.currentIndex < this.sortedNodes.length) {
      yield this.sortedNodes[this.currentIndex++];
    }
  }

  onTaskCompleted(_taskId: unknown): void {
    // Topological scheduler doesn't need to track individual task completion
  }

  onTaskStreaming(_taskId: unknown): void {
    // Topological scheduler doesn't support streaming-aware scheduling
  }

  reset(): void {
    this.sortedNodes = this.dag.topologicallySortedNodes();
    this.currentIndex = 0;
  }
}

/**
 * Event-driven scheduler that executes tasks as soon as their dependencies are satisfied
 * Most efficient for parallel execution but requires completion notifications
 */
export class DependencyBasedScheduler implements ITaskGraphScheduler {
  private completedTasks: Set<unknown>;
  private streamingTasks: Set<unknown>;
  private pendingTasks: Set<ITask>;
  private nextResolver: ((task: ITask | null) => void) | null = null;

  constructor(private dag: TaskGraph) {
    this.completedTasks = new Set();
    this.streamingTasks = new Set();
    this.pendingTasks = new Set();
    this.reset();
  }

  private isTaskReady(task: ITask): boolean {
    // DISABLED tasks are never ready - they should be skipped
    if (task.status === TaskStatus.DISABLED) {
      return false;
    }

    const sourceDataflows = this.dag.getSourceDataflows(task.id);

    // If task has incoming dataflows, check if all are DISABLED
    // (In that case, task will be disabled by propagateDisabledStatus, not ready to run)
    if (sourceDataflows.length > 0) {
      const allIncomingDisabled = sourceDataflows.every((df) => df.status === TaskStatus.DISABLED);
      if (allIncomingDisabled) {
        return false;
      }
    }

    // A task is ready if all its non-disabled dependencies are completed.
    // DISABLED dataflows are considered "satisfied" (their branch was not taken).
    //
    // Per-edge streaming: when the source output port AND the target input port
    // both declare matching `x-stream`, the dependency can be satisfied by
    // STREAMING status (not just COMPLETED). Edges where the target port does
    // NOT accept streams still require full completion.
    const activeDataflows = sourceDataflows.filter((df) => df.status !== TaskStatus.DISABLED);

    return activeDataflows.every((df) => {
      const depId = df.sourceTaskId;
      if (this.completedTasks.has(depId)) return true;

      // Check if this specific edge supports stream pass-through
      if (this.streamingTasks.has(depId)) {
        const sourceTask = this.dag.getTask(depId);
        if (sourceTask) {
          const sourceMode = getPortStreamMode(sourceTask.outputSchema(), df.sourceTaskPortId);
          const targetMode = getPortStreamMode(task.inputSchema(), df.targetTaskPortId);
          if (sourceMode !== "none" && sourceMode === targetMode) {
            return true;
          }
        }
      }

      return false;
    });
  }

  private async waitForNextTask(): Promise<ITask | null> {
    if (this.pendingTasks.size === 0) return null;

    // Remove any disabled tasks from pending (they were disabled by propagateDisabledStatus)
    for (const task of Array.from(this.pendingTasks)) {
      if (task.status === TaskStatus.DISABLED) {
        this.pendingTasks.delete(task);
      }
    }

    if (this.pendingTasks.size === 0) return null;

    const readyTask = Array.from(this.pendingTasks).find((task) => this.isTaskReady(task));
    if (readyTask) {
      this.pendingTasks.delete(readyTask);
      return readyTask;
    }

    // If there are pending tasks but none are ready, wait for task completion
    if (this.pendingTasks.size > 0) {
      return new Promise((resolve) => {
        this.nextResolver = resolve;
      });
    }

    return null;
  }

  async *tasks(): AsyncIterableIterator<ITask> {
    while (this.pendingTasks.size > 0) {
      const task = await this.waitForNextTask();
      if (task) {
        yield task;
      } else {
        break;
      }
    }
  }

  onTaskCompleted(taskId: unknown): void {
    this.completedTasks.add(taskId);

    // Remove any disabled tasks from pending
    for (const task of Array.from(this.pendingTasks)) {
      if (task.status === TaskStatus.DISABLED) {
        this.pendingTasks.delete(task);
      }
    }

    // Check if any pending tasks are now ready
    if (this.nextResolver) {
      const readyTask = Array.from(this.pendingTasks).find((task) => this.isTaskReady(task));
      if (readyTask) {
        this.pendingTasks.delete(readyTask);
        const resolver = this.nextResolver;
        this.nextResolver = null;
        resolver(readyTask);
      } else if (this.pendingTasks.size === 0) {
        // No more pending tasks - resolve with null to signal completion
        const resolver = this.nextResolver;
        this.nextResolver = null;
        resolver(null);
      }
    }
  }

  onTaskStreaming(taskId: unknown): void {
    this.streamingTasks.add(taskId);

    // Remove any disabled tasks from pending
    for (const task of Array.from(this.pendingTasks)) {
      if (task.status === TaskStatus.DISABLED) {
        this.pendingTasks.delete(task);
      }
    }

    // Check if any pending streamable tasks are now ready
    // (they can start when deps are STREAMING, not just COMPLETED)
    if (this.nextResolver) {
      const readyTask = Array.from(this.pendingTasks).find((task) => this.isTaskReady(task));
      if (readyTask) {
        this.pendingTasks.delete(readyTask);
        const resolver = this.nextResolver;
        this.nextResolver = null;
        resolver(readyTask);
      }
    }
  }

  reset(): void {
    this.completedTasks.clear();
    this.streamingTasks.clear();
    this.pendingTasks = new Set(this.dag.topologicallySortedNodes());
    this.nextResolver = null;
  }
}
