/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { Workflow } from "../task-graph/Workflow";
import { CreateEndLoopWorkflow, CreateLoopWorkflow } from "../task-graph/WorkflowFactories";
import type { IRunConfig } from "./ITask";
import type { IterationAnalysisResult, IteratorTaskConfig } from "./IteratorTask";
import { IteratorTask, iteratorTaskConfigSchema } from "./IteratorTask";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

export const reduceTaskConfigSchema = {
  type: "object",
  properties: {
    ...iteratorTaskConfigSchema["properties"],
    initialValue: {},
  },
  required: iteratorTaskConfigSchema.required,
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ReduceTaskConfig<
  Input extends TaskInput = TaskInput,
  Accumulator = unknown,
> = IteratorTaskConfig<Input> & {
  readonly initialValue?: Accumulator;
};

/**
 * ReduceTask processes iterated inputs sequentially with an accumulator.
 */
export class ReduceTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends ReduceTaskConfig<Input, Output> = ReduceTaskConfig<Input, Output>,
> extends IteratorTask<Input, Output, Config> {
  public static override type: TaskTypeName = "ReduceTask";
  public static override category: string = "Flow Control";
  public static override title: string = "Reduce";
  public static override description: string =
    "Processes iterated inputs sequentially with an accumulator (fold)";

  public static override configSchema(): DataPortSchema {
    return reduceTaskConfigSchema;
  }

  constructor(config: Partial<Config> = {}, runConfig: Partial<IRunConfig> = {}) {
    // Reduce is always sequential
    const reduceConfig = {
      ...config,
      concurrencyLimit: 1,
      batchSize: 1,
    };
    super(reduceConfig as Partial<Config>, runConfig);
  }

  public get initialValue(): Output {
    return (this.config.initialValue ?? {}) as Output;
  }

  public override isReduceTask(): boolean {
    return true;
  }

  public override getInitialAccumulator(): Output {
    const value = this.initialValue;
    if (Array.isArray(value)) {
      return [...value] as unknown as Output;
    }
    if (value && typeof value === "object") {
      return { ...(value as Record<string, unknown>) } as Output;
    }
    return value;
  }

  public override buildIterationRunInput(
    analysis: IterationAnalysisResult,
    index: number,
    iterationCount: number,
    extraInput: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return super.buildIterationRunInput(analysis, index, iterationCount, {
      accumulator: extraInput.accumulator,
    });
  }

  public override getEmptyResult(): Output {
    return this.getInitialAccumulator();
  }

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public override outputSchema(): DataPortSchema {
    if (!this.hasChildren()) {
      return (this.constructor as typeof ReduceTask).outputSchema();
    }

    const endingNodes = this.subGraph
      .getTasks()
      .filter((task) => this.subGraph.getTargetDataflows(task.id).length === 0);

    if (endingNodes.length === 0) {
      return (this.constructor as typeof ReduceTask).outputSchema();
    }

    const properties: Record<string, unknown> = {};

    for (const task of endingNodes) {
      const taskOutputSchema = task.outputSchema();
      if (typeof taskOutputSchema === "boolean") continue;

      for (const [key, schema] of Object.entries(taskOutputSchema.properties || {})) {
        if (!properties[key]) {
          // The reduce output is the accumulated value of the final iteration,
          // never a live stream — a child port's x-stream annotation must not
          // survive onto the aggregate schema, or the run would be routed
          // through executeStream and skip the iterations entirely.
          if (typeof schema === "object" && schema !== null && "x-stream" in schema) {
            const { ["x-stream"]: _xStream, ...rest } = schema as Record<string, unknown>;
            properties[key] = rest;
          } else {
            properties[key] = schema;
          }
        }
      }
    }

    return {
      type: "object",
      properties,
      additionalProperties: false,
    } as DataPortSchema;
  }
}

// ============================================================================
// Workflow Prototype Extensions
// ============================================================================

declare module "../task-graph/Workflow" {
  interface Workflow {
    /**
     * Starts a reduce loop that processes iterated inputs with an accumulator.
     * Use .endReduce() to close the loop and return to the parent workflow.
     */
    reduce: CreateLoopWorkflow<TaskInput, TaskOutput, ReduceTaskConfig<TaskInput, any>>;

    /**
     * Ends the reduce loop and returns to the parent workflow.
     */
    endReduce(): Workflow;
  }
}

queueMicrotask(() => {
  Workflow.prototype.reduce = CreateLoopWorkflow(ReduceTask);
  Workflow.prototype.endReduce = CreateEndLoopWorkflow("endReduce");
});
