/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

function stringIncludes(text: string, search: string): boolean {
  return text.includes(search);
}

const inputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Input string to search in",
    },
    search: {
      type: "string",
      title: "Search",
      description: "Substring to search for",
    },
  },
  required: ["text", "search"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    included: {
      type: "boolean",
      title: "Included",
      description: "Whether the string contains the search substring",
    },
  },
  required: ["included"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringIncludesTaskInput = FromSchema<typeof inputSchema>;
export type StringIncludesTaskOutput = FromSchema<typeof outputSchema>;

export class StringIncludesTask<
  Input extends StringIncludesTaskInput = StringIncludesTaskInput,
  Output extends StringIncludesTaskOutput = StringIncludesTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringIncludesTask";
  static override readonly category = "String";
  public static override title = "Includes";
  public static override description = "Checks if a string contains a substring";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return { included: stringIncludes(input.text, input.search) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { included: stringIncludes(input.text, input.search) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringIncludes: CreateWorkflow<StringIncludesTaskInput, StringIncludesTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringIncludes = CreateWorkflow(StringIncludesTask);
