/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy } from "@workglow/task-graph";
import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";

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

  // Handle array input
  if (Array.isArray(inputValue)) {
    inputValue.forEach((item, index) => {
      (output as any)[`output_${index}`] = item;
    });
  } else {
    // Handle single value as a single-element array
    (output as any).output_0 = inputValue;
  }

  return output;
}

/**
 * SplitTask takes an array or single value as input and creates
 * separate outputs for each element. Each output is named by its index (0, 1, 2, etc.).
 * Useful for workflows that need to process array elements in parallel branches.
 *
 * Features:
 * - Accepts both arrays and single values as input
 * - Creates one output per array element (output_0, output_1, etc.)
 * - Single values are treated as a single-element array
 * - Output count matches array length
 *
 * Example:
 * Input: { input: [1, 2, 3] }
 * Output: { output_0: 1, output_1: 2, output_2: 3 }
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
