/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

function trimString(text: string): string {
  return text.trim();
}

const inputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Input string",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Trimmed string",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringTrimTaskInput = FromSchema<typeof inputSchema>;
export type StringTrimTaskOutput = FromSchema<typeof outputSchema>;

export class StringTrimTask<
  Input extends StringTrimTaskInput = StringTrimTaskInput,
  Output extends StringTrimTaskOutput = StringTrimTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringTrimTask";
  static override readonly category = "String";
  public static override title = "Trim";
  public static override description = "Removes leading and trailing whitespace from a string";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return { text: trimString(input.text) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { text: trimString(input.text) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringTrim: CreateWorkflow<StringTrimTaskInput, StringTrimTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringTrim = CreateWorkflow(StringTrimTask);
