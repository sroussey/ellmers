/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

function sliceString(text: string, start: number, end: number | undefined): string {
  return text.slice(start, end);
}

const inputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Input string",
    },
    start: {
      type: "integer",
      title: "Start",
      description: "Start index (inclusive, supports negative indexing)",
    },
    end: {
      type: "integer",
      title: "End",
      description: "End index (exclusive, supports negative indexing)",
    },
  },
  required: ["text", "start"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Extracted substring",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringSliceTaskInput = FromSchema<typeof inputSchema>;
export type StringSliceTaskOutput = FromSchema<typeof outputSchema>;

export class StringSliceTask<
  Input extends StringSliceTaskInput = StringSliceTaskInput,
  Output extends StringSliceTaskOutput = StringSliceTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringSliceTask";
  static override readonly category = "String";
  public static override title = "Slice";
  public static override description = "Extracts a substring by start and optional end index";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return { text: sliceString(input.text, input.start, input.end) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { text: sliceString(input.text, input.start, input.end) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringSlice: CreateWorkflow<StringSliceTaskInput, StringSliceTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringSlice = CreateWorkflow(StringSliceTask);
