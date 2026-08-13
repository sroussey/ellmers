/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    input: {
      title: "Single Input",
      description: "A single value to output",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type SplitTaskInput = FromSchema<typeof inputSchema>;
export type SplitTaskOutput = FromSchema<typeof outputSchema>;

function fanoutToIndexedOutputs<Output extends SplitTaskOutput>(inputValue: unknown): Output {
  const output = {} as Output;

  if (Array.isArray(inputValue)) {
    inputValue.forEach((item, index) => {
      (output as any)[`output_${index}`] = item;
    });
  } else {
    (output as any).output_0 = inputValue;
  }

  return output;
}

/**
 * Splits an array (or single value) input into one output per element, named
 * `output_0`, `output_1`, ... Single values become a single-element output.
 */
export class SplitTask<
  Input extends SplitTaskInput = SplitTaskInput,
  Output extends SplitTaskOutput = SplitTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  public static override type = "SplitTask";
  public static override category = "Utility";
  public static override title = "Split";
  public static override description =
    "Splits an array into individual outputs, creating one output per element";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema() {
    return inputSchema;
  }

  public static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return fanoutToIndexedOutputs<Output>(input.input);
  }

  override async executePreview(input: Input): Promise<Output | undefined> {
    return fanoutToIndexedOutputs<Output>(input.input);
  }
}

export const split = (input: SplitTaskInput, config: TaskConfig = {}) => {
  const task = new SplitTask(config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    split: CreateWorkflow<SplitTaskInput, SplitTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.split = CreateWorkflow(SplitTask);
