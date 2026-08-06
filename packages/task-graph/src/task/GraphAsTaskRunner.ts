/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridgeSubGraphTaskEvents } from "../task-graph/SubGraphEventBridge";
import type { GraphResultArray } from "../task-graph/TaskGraphRunner";
import type { GraphAsTask, GraphAsTaskConfig } from "./GraphAsTask";
import type { TaskRunContext } from "./TaskRunContext";
import { TaskRunner } from "./TaskRunner";
import type { TaskInput, TaskOutput } from "./TaskTypes";

export class GraphAsTaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends GraphAsTaskConfig<Input> = GraphAsTaskConfig<Input>,
> extends TaskRunner<Input, Output, Config> {
  declare task: GraphAsTask<Input, Output, Config>;

  /**
   * Protected method to execute a task subgraph by delegating back to the task itself.
   */
  protected async executeTaskChildren(input: Input): Promise<GraphResultArray<Output>> {
    // Route inner graph_progress through handleProgress so the outer graph's
    // updateProgress callback fires (updating task.progress and re-emitting
    // graph_progress up the chain). A bare emit on the task was silently
    // dropped by the outer TaskGraphRunner, leaving parent progress stuck at
    // the value from whichever task ran before this one. Mirrors the pattern
    // used by FallbackTaskRunner, IteratorTaskRunner, and WhileTask.
    const unsubscribe = this.task.subGraph!.subscribe(
      "graph_progress",
      (progress: number | undefined, message?: string, ...args: any[]) => {
        void this.handleProgress(progress, message, ...args);
      }
    );

    // Bubble inner-task events up to the parent graph so subgraph children
    // surface as individual task events on the top-level stream (used for
    // previews and progress colors). Bubbles recursively: a nested compound
    // task forwards its own subgraph to us, and we forward it onward.
    const parent = this.task.parentGraph;
    const unbridge = parent ? bridgeSubGraphTaskEvents(this.task.subGraph!, parent) : () => {};

    try {
      return await this.task.subGraph!.run<Output>(input, {
        parentSignal: this.currentCtx?.abortController.signal,
        outputCache: this.outputCache,
        registry: this.registry,
        resourceScope: this.resourceScope,
        ...this.streamRunOptions,
      });
    } finally {
      // Always tear down — if subGraph.run() rejects (timeout/abort/inner
      // failure) and this task is later re-run on the same instance, leaked
      // subscriptions would double-emit every inner event to the parent.
      unsubscribe();
      unbridge();
    }
  }
  /**
   * Protected method for preview execution delegation
   *
   * For GraphAsTask, we pass the parent's runInputData to the subgraph's runPreview.
   * This ensures that root tasks in the subgraph (like InputTask) receive the
   * parent's input values after resetInputData() is called.
   */
  protected async executeTaskChildrenPreview(): Promise<GraphResultArray<Output>> {
    return this.task.subGraph!.runPreview<Output>(this.task.runInputData, {
      registry: this.registry,
      resourceScope: this.resourceScope,
    });
  }

  protected override async handleDisable(ctx: TaskRunContext | undefined): Promise<void> {
    if (this.task.hasChildren()) {
      await this.task.subGraph!.disable();
    }
    await super.handleDisable(ctx);
  }

  // ========================================================================
  // TaskRunner method overrides and helpers
  // ========================================================================

  /**
   * Execute the task
   */
  protected override async executeTask(
    input: Input,
    ctx: TaskRunContext
  ): Promise<Output | undefined> {
    if (this.task.hasChildren()) {
      const runExecuteOutputData = await this.executeTaskChildren(input);
      this.task.runOutputData = this.task.subGraph.mergeExecuteOutputsToRunOutput(
        runExecuteOutputData,
        this.task.compoundMerge
      );
    } else {
      const result = await super.executeTask(input, ctx);
      this.task.runOutputData = result ?? ({} as Output);
    }
    return this.task.runOutputData as Output;
  }

  /**
   * Execute the task in preview mode
   */
  public override async executeTaskPreview(
    input: Input,
    ctx: TaskRunContext
  ): Promise<Output | undefined> {
    if (this.task.hasChildren()) {
      const previewResults = await this.executeTaskChildrenPreview();
      this.task.runOutputData = this.task.subGraph.mergeExecuteOutputsToRunOutput(
        previewResults,
        this.task.compoundMerge
      );
      return this.task.runOutputData as Output;
    } else {
      const previewResult = await super.executeTaskPreview(input, ctx);
      if (previewResult !== undefined) {
        this.task.runOutputData = previewResult;
      }
      return this.task.runOutputData as Output;
    }
  }
}
