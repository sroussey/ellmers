/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphResultArray } from "../task-graph/TaskGraphRunner";
import type { GraphAsTaskConfig } from "./GraphAsTask";
import { GraphAsTask } from "./GraphAsTask";
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
      (progress: number, message?: string, ...args: any[]) => {
        void this.handleProgress(progress, message, ...args);
      }
    );
    const results = await this.task.subGraph!.run<Output>(input, {
      parentSignal: this.abortController?.signal,
      outputCache: this.outputCache,
      registry: this.registry,
      resourceScope: this.resourceScope,
    });
    unsubscribe();
    return results;
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

  protected override async handleDisable(): Promise<void> {
    if (this.task.hasChildren()) {
      await this.task.subGraph!.disable();
    }
    super.handleDisable();
  }

  // ========================================================================
  // TaskRunner method overrides and helpers
  // ========================================================================

  /**
   * Execute the task
   */
  protected override async executeTask(input: Input): Promise<Output | undefined> {
    if (this.task.hasChildren()) {
      const runExecuteOutputData = await this.executeTaskChildren(input);
      this.task.runOutputData = this.task.subGraph.mergeExecuteOutputsToRunOutput(
        runExecuteOutputData,
        this.task.compoundMerge
      );
    } else {
      const result = await super.executeTask(input);
      this.task.runOutputData = result ?? ({} as Output);
    }
    return this.task.runOutputData as Output;
  }

  /**
   * Execute the task in preview mode
   */
  public override async executeTaskPreview(input: Input): Promise<Output | undefined> {
    if (this.task.hasChildren()) {
      const previewResults = await this.executeTaskChildrenPreview();
      this.task.runOutputData = this.task.subGraph.mergeExecuteOutputsToRunOutput(
        previewResults,
        this.task.compoundMerge
      );
      return this.task.runOutputData as Output;
    } else {
      const previewResult = await super.executeTaskPreview(input);
      if (previewResult !== undefined) {
        this.task.runOutputData = previewResult;
      }
      return this.task.runOutputData as Output;
    }
  }
}
