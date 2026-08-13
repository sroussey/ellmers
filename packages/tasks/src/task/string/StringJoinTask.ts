/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

function joinStrings(texts: readonly string[], separator: string | undefined): string {
  return texts.join(separator ?? "");
}

const inputSchema = {
  type: "object",
  properties: {
    texts: {
      type: "array",
      items: { type: "string" },
      title: "Texts",
      description: "Array of strings to join",
    },
    separator: {
      type: "string",
      title: "Separator",
      description: "Separator between elements",
      default: "",
    },
  },
  required: ["texts"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Joined string",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringJoinTaskInput = FromSchema<typeof inputSchema>;
export type StringJoinTaskOutput = FromSchema<typeof outputSchema>;

export class StringJoinTask<
  Input extends StringJoinTaskInput = StringJoinTaskInput,
  Output extends StringJoinTaskOutput = StringJoinTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringJoinTask";
  static override readonly category = "String";
  public static override title = "Join";
  public static override description = "Joins an array of strings with a separator";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return { text: joinStrings(input.texts, input.separator) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { text: joinStrings(input.texts, input.separator) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringJoin: CreateWorkflow<StringJoinTaskInput, StringJoinTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringJoin = CreateWorkflow(StringJoinTask);
