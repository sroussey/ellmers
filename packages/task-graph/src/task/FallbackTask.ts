/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { Workflow } from "../task-graph/Workflow";
import type { CreateLoopWorkflow } from "../task-graph/WorkflowFactories";
import { CreateEndLoopWorkflow } from "../task-graph/WorkflowFactories";
import { FallbackTaskRunner } from "./FallbackTaskRunner";
import type { GraphAsTaskConfig } from "./GraphAsTask";
import { GraphAsTask, graphAsTaskConfigSchema } from "./GraphAsTask";
import type { TaskGraphJsonOptions } from "./TaskJSON";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Execution mode for the fallback task.
 * - `"task"`: each task in the subgraph is an independent alternative tried sequentially.
 * - `"data"`: the subgraph is a template workflow re-run with each entry in `alternatives`.
 */
export type FallbackMode = "task" | "data";

export const fallbackTaskConfigSchema = {
  type: "object",
  properties: {
    ...graphAsTaskConfigSchema["properties"],
    fallbackMode: { type: "string", enum: ["task", "data"] },
    alternatives: { type: "array", items: { type: "object", additionalProperties: true } },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FallbackTaskConfig<Input extends TaskInput = TaskInput> = GraphAsTaskConfig<Input> & {
  /**
   * The fallback execution mode.
   * - `"task"`: Try each task in the subgraph as an alternative.
   * - `"data"`: Try the template workflow with each set of input overrides.
   * @default "task"
   */
  readonly fallbackMode?: FallbackMode;

  /**
   * Array of input overrides for data mode.
   * Each entry is merged with the task input before running the template.
   * Only used when `fallbackMode` is `"data"`.
   *
   * @example
   * ```typescript
   * alternatives: [
   *   { model: "openai:gpt-4" },
   *   { model: "anthropic:claude-sonnet-4-20250514" },
   *   { model: "onnx:Xenova/LaMini-Flan-T5-783M:q8" },
   * ]
   * ```
   */
  readonly alternatives?: Record<string, unknown>[];
};

/**
 * Tries multiple alternatives and returns the first successful result.
 *
 * In task mode each child is an independent alternative tried sequentially;
 * in data mode the subgraph is a template re-run with each entry in
 * `alternatives` merged into the input. If all alternatives fail a
 * `TaskFailedError` aggregating each attempt's error is thrown.
 */
export class FallbackTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends FallbackTaskConfig<Input> = FallbackTaskConfig<Input>,
> extends GraphAsTask<Input, Output, Config> {
  // ========================================================================
  // Static properties
  // ========================================================================

  public static override type: TaskTypeName = "FallbackTask";
  public static override category: string = "Flow Control";
  public static override title: string = "Fallback";
  public static override description: string = "Try alternatives until one succeeds";

  public static override hasDynamicSchemas: boolean = true;

  public static override configSchema(): DataPortSchema {
    return fallbackTaskConfigSchema;
  }

  // ========================================================================
  // TaskRunner Override
  // ========================================================================

  declare _runner: FallbackTaskRunner<Input, Output, Config>;

  override get runner(): FallbackTaskRunner<Input, Output, Config> {
    if (!this._runner) {
      this._runner = new FallbackTaskRunner<Input, Output, Config>(this);
    }
    return this._runner;
  }

  // ========================================================================
  // Config accessors
  // ========================================================================

  public get fallbackMode(): FallbackMode {
    return this.config?.fallbackMode ?? "task";
  }

  public get alternatives(): Record<string, unknown>[] {
    return this.config?.alternatives ?? [];
  }

  // ========================================================================
  // Schema Methods
  // ========================================================================

  /**
   * In task mode, input schema is the union of all alternative tasks' inputs.
   * In data mode, input schema comes from the template workflow's starting nodes.
   */
  public override inputSchema(): DataPortSchema {
    if (!this.hasChildren()) {
      return (this.constructor as typeof FallbackTask).inputSchema();
    }

    if (this.fallbackMode === "data") {
      // Data mode: use the base GraphAsTask logic (union of starting node inputs)
      return super.inputSchema();
    }

    // Task mode: union of all tasks' input schemas (they are independent alternatives)
    const properties: Record<string, unknown> = {};
    const tasks = this.subGraph.getTasks();

    for (const task of tasks) {
      const taskInputSchema = task.inputSchema();
      if (typeof taskInputSchema === "boolean") continue;
      const taskProperties = taskInputSchema.properties || {};

      for (const [inputName, inputProp] of Object.entries(taskProperties)) {
        if (!properties[inputName]) {
          properties[inputName] = inputProp;
        }
      }
    }

    return {
      type: "object",
      properties,
      additionalProperties: true,
    } as DataPortSchema;
  }

  /**
   * Output schema is derived from the first task in the subgraph.
   * All alternatives should produce compatible output.
   */
  public override outputSchema(): DataPortSchema {
    if (!this.hasChildren()) {
      return (this.constructor as typeof FallbackTask).outputSchema();
    }

    const tasks = this.subGraph.getTasks();
    if (tasks.length === 0) {
      return { type: "object", properties: {}, additionalProperties: false } as DataPortSchema;
    }

    if (this.fallbackMode === "task") {
      // Task mode: use the first task's output schema (all alternatives should be compatible)
      const firstTask = tasks[0];
      return firstTask.outputSchema();
    }

    // Data mode: use the ending nodes' output schema via base class logic
    return super.outputSchema();
  }

  // ========================================================================
  // Serialization
  // ========================================================================

  public override toJSON(options?: TaskGraphJsonOptions) {
    const json = super.toJSON(options);
    return {
      ...json,
      config: {
        ...("config" in json ? json.config : {}),
        fallbackMode: this.fallbackMode,
        ...(this.alternatives.length > 0 ? { alternatives: this.alternatives } : {}),
      },
    };
  }
}

// ============================================================================
// Workflow Prototype Extensions
// ============================================================================

declare module "../task-graph/Workflow" {
  interface Workflow {
    /**
     * Starts a task-mode fallback block. Each task added inside the block
     * is an independent alternative tried sequentially until one succeeds.
     * Use `.endFallback()` to close the block and return to the parent workflow.
     */
    fallback: CreateLoopWorkflow<TaskInput, TaskOutput, FallbackTaskConfig<TaskInput>>;

    /**
     * Ends the task-mode fallback block and returns to the parent workflow.
     */
    endFallback(): Workflow;

    /**
     * Starts a data-mode fallback block. The tasks added inside the block
     * form a template workflow that is re-run with each set of input overrides
     * from `alternatives`. Use `.endFallbackWith()` to close the block.
     *
     * @param alternatives - Array of input override objects to try sequentially
     */
    fallbackWith(alternatives: Record<string, unknown>[]): Workflow;

    /**
     * Ends the data-mode fallback block and returns to the parent workflow.
     */
    endFallbackWith(): Workflow;
  }
}

queueMicrotask(() => {
  Workflow.prototype.fallback = function (this: Workflow): Workflow {
    return this.addLoopTask(FallbackTask, { fallbackMode: "task" });
  };
  Workflow.prototype.endFallback = CreateEndLoopWorkflow("endFallback");

  Workflow.prototype.fallbackWith = function (
    this: Workflow,
    alternatives: Record<string, unknown>[]
  ): Workflow {
    return this.addLoopTask(FallbackTask, {
      fallbackMode: "data",
      alternatives,
    });
  };
  Workflow.prototype.endFallbackWith = CreateEndLoopWorkflow("endFallbackWith");
});
