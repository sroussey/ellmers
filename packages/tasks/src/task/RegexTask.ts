/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, TaskInvalidInputError, Workflow } from "@workglow/task-graph";
import { SECURITY_LIMITS } from "@workglow/util";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

/**
 * Detects regex patterns prone to catastrophic backtracking (ReDoS).
 * Checks for nested quantifiers like (a+)+, (a*)+, (a+)*, etc.
 */
function hasNestedQuantifiers(pattern: string): boolean {
  // Strip character classes to avoid false positives on quantifiers inside [...]
  const withoutClasses = pattern.replace(/\[(?:[^\]\\]|\\.)*\]/g, "X");
  // Detect group with inner quantifier followed by outer quantifier
  return /\([^)*+]*[*+][^)]*\)[+*?]|\([^)*+]*[*+][^)]*\)\{/.test(withoutClasses);
}

function executeRegex(input: { value: string; pattern: string; flags?: string }): {
  match: boolean;
  matches: string[];
} {
  const bracketCount = (input.pattern.match(/\[/g) ?? []).length;
  if (bracketCount > SECURITY_LIMITS.regexMaxBracketCount) {
    throw new TaskInvalidInputError(
      "Regex pattern rejected: too many '[' characters (potential ReDoS). " +
        "Simplify the pattern to reduce complexity."
    );
  }

  if (hasNestedQuantifiers(input.pattern)) {
    throw new TaskInvalidInputError(
      "Regex pattern rejected: nested quantifiers detected (potential ReDoS). " +
        "Simplify the pattern to avoid catastrophic backtracking."
    );
  }

  const flags = input.flags ?? "";
  const regex = new RegExp(input.pattern, flags);

  if (flags.includes("g")) {
    const allMatches = Array.from(input.value.matchAll(new RegExp(input.pattern, flags)));
    return {
      match: allMatches.length > 0,
      matches: allMatches.map((m) => m[0]),
    };
  }

  const result = regex.exec(input.value);
  if (!result) {
    return { match: false, matches: [] as string[] };
  }

  // Return full match + captured groups
  return {
    match: true,
    matches: result.slice(0),
  };
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
