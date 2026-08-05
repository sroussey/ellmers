/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    output: {
      type: "array",
      title: "Merged Array",
      description: "Array containing all input values in order",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type MergeTaskInput = FromSchema<typeof inputSchema>;
export type MergeTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Merges multiple input properties into a single array output. Properties are
 * sorted by key name (natural numeric) for deterministic ordering.
 *
 * Example: `{ input_0: "a", input_1: "b" }` → `{ output: ["a", "b"] }`.
 */
export class MergeTask<
  Input extends MergeTaskInput = MergeTaskInput,
  Output extends MergeTaskOutput = MergeTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  public static override type = "MergeTask";
  public static override category = "Utility";
  public static override title = "Merge";
  public static override description = "Merges multiple inputs into a single array output";
  static override readonly cacheable = true;

  public static override inputSchema() {
    return inputSchema;
  }

  public static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    const keys = Object.keys(input).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

    const values = keys.map((key) => input[key]);

    return {
      output: values,
    } as Output;
  }
}

export const merge = (input: MergeTaskInput, config: TaskConfig = {}) => {
  const task = new MergeTask(config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    merge: CreateWorkflow<MergeTaskInput, MergeTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.merge = CreateWorkflow(MergeTask);
