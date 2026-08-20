/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { getRegexRunnerFactory } from "../util/BoundedRegexRunner";
import { compileSafeRegex } from "../util/regexSafety";

function executeRegex(input: { value: string; pattern: string; flags?: string }): {
  match: boolean;
  matches: string[];
} {
  const flags = input.flags ?? "";
  const runner = getRegexRunnerFactory()(compileSafeRegex(input.pattern, flags));

  if (flags.includes("g")) {
    const matches = runner.execAll(input.value);
    return { match: matches.length > 0, matches };
  }

  const result = runner.exec(input.value);
  if (result === undefined) {
    return { match: false, matches: [] as string[] };
  }

  // Return full match + captured groups
  return { match: true, matches: result as string[] };
}

const inputSchema = {
  type: "object",
  properties: {
    value: {
      type: "string",
      title: "Value",
      description: "Input string to match against",
    },
    pattern: {
      type: "string",
      title: "Pattern",
      description: "Regular expression pattern",
    },
    flags: {
      type: "string",
      title: "Flags",
      description: "Regex flags (e.g. 'g', 'i', 'gi')",
      default: "",
    },
  },
  required: ["value", "pattern"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    match: {
      type: "boolean",
      title: "Match",
      description: "Whether the pattern matched",
    },
    matches: {
      type: "array",
      items: { type: "string" },
      title: "Matches",
      description: "Array of matched strings (full matches when global, groups when not)",
    },
  },
  required: ["match", "matches"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type RegexTaskInput = FromSchema<typeof inputSchema>;
export type RegexTaskOutput = FromSchema<typeof outputSchema>;

export class RegexTask<
  Input extends RegexTaskInput = RegexTaskInput,
  Output extends RegexTaskOutput = RegexTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "RegexTask";
  static override readonly category = "String";
  public static override title = "Regex";
  public static override description = "Matches a string against a regular expression pattern";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return executeRegex(input) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return executeRegex(input) as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    regex: CreateWorkflow<RegexTaskInput, RegexTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.regex = CreateWorkflow(RegexTask);
