/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

function toLowerCase(text: string): string {
  return text.toLowerCase();
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
      description: "Lowercased string",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringLowerCaseTaskInput = FromSchema<typeof inputSchema>;
export type StringLowerCaseTaskOutput = FromSchema<typeof outputSchema>;

export class StringLowerCaseTask<
  Input extends StringLowerCaseTaskInput = StringLowerCaseTaskInput,
  Output extends StringLowerCaseTaskOutput = StringLowerCaseTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringLowerCaseTask";
  static override readonly category = "String";
  public static override title = "Lower Case";
  public static override description = "Converts a string to lower case";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return { text: toLowerCase(input.text) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { text: toLowerCase(input.text) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringLowerCase: CreateWorkflow<
      StringLowerCaseTaskInput,
      StringLowerCaseTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.stringLowerCase = CreateWorkflow(StringLowerCaseTask);
