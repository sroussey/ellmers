/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

function toUpperCase(text: string): string {
  return text.toUpperCase();
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
      description: "Uppercased string",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringUpperCaseTaskInput = FromSchema<typeof inputSchema>;
export type StringUpperCaseTaskOutput = FromSchema<typeof outputSchema>;

export class StringUpperCaseTask<
  Input extends StringUpperCaseTaskInput = StringUpperCaseTaskInput,
  Output extends StringUpperCaseTaskOutput = StringUpperCaseTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringUpperCaseTask";
  static override readonly category = "String";
  public static override title = "Upper Case";
  public static override description = "Converts a string to upper case";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return { text: toUpperCase(input.text) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { text: toUpperCase(input.text) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringUpperCase: CreateWorkflow<
      StringUpperCaseTaskInput,
      StringUpperCaseTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.stringUpperCase = CreateWorkflow(StringUpperCaseTask);
