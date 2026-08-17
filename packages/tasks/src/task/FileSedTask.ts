/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskConfig } from "@workglow/task-graph";
import {
  CreateWorkflow,
  Task,
  TaskAbortedError,
  TaskInvalidInputError,
  Workflow,
} from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { assertSafeRegexPattern, escapeRegExp } from "../util/regexSafety";
import { linesFromText } from "../util/textLines";
import { FetchUrlTask } from "./FetchUrlTask";

const inputSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      title: "URL",
      description: "URL to transform (http://, https://)",
      format: "uri",
    },
    pattern: {
      type: "string",
      title: "Pattern",
      description: "Regular expression, or a literal string when fixedString is set",
    },
    replacement: {
      type: "string",
      title: "Replacement",
      description:
        "Text substituted for each match. Supports $1/$& when the pattern is a regular expression; literal when fixedString is set",
    },
    ignoreCase: {
      type: "boolean",
      title: "Ignore Case",
      description: "Case-insensitive matching (s///i)",
    },
    fixedString: {
      type: "boolean",
      title: "Fixed String",
      description: "Treat pattern and replacement as literal strings",
    },
    global: {
      type: "boolean",
      title: "Global",
      description: "Replace every occurrence on a line rather than the first (s///g)",
    },
    maxReplacements: {
      type: "integer",
      title: "Max Replacements",
      description: "Stop substituting after this many replacements; later lines pass through",
      minimum: 1,
    },
    onlyChangedLines: {
      type: "boolean",
      title: "Only Changed Lines",
      description: "Emit only the lines that changed (sed -n 's///p')",
    },
    maxOutputLines: {
      type: "integer",
      title: "Max Output Lines",
      description: "Maximum number of output lines",
      minimum: 0,
    },
    maxOutputChars: {
      type: "integer",
      title: "Max Output Characters",
      description: "Maximum number of output characters, including newlines",
      minimum: 0,
    },
  },
  required: ["url", "pattern", "replacement"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Transformed document",
    },
    replacementCount: {
      type: "integer",
      title: "Replacement Count",
      description: "Number of substitutions performed",
    },
    linesChanged: {
      type: "integer",
      title: "Lines Changed",
      description: "Number of lines with at least one substitution",
    },
    truncated: {
      type: "boolean",
      title: "Truncated",
      description: "Output stopped before EOF because of an output limit",
    },
  },
  required: ["text", "replacementCount", "linesChanged", "truncated"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FileSedTaskInput = FromSchema<typeof inputSchema>;
export type FileSedTaskOutput = FromSchema<typeof outputSchema>;

type SedOptions = Omit<FileSedTaskInput, "url" | "pattern" | "replacement">;

interface LineSubstitution {
  readonly text: string;
  readonly replacements: number;
}

function validateOptions(options: SedOptions): void {
  const integerOptions: Array<[keyof SedOptions, number | undefined]> = [
    ["maxReplacements", options.maxReplacements],
    ["maxOutputLines", options.maxOutputLines],
    ["maxOutputChars", options.maxOutputChars],
  ];

  for (const [name, value] of integerOptions) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new TaskInvalidInputError(`${String(name)} must be a non-negative integer`);
    }
  }

  if (options.maxReplacements === 0) {
    throw new TaskInvalidInputError("maxReplacements must be greater than zero when specified");
  }
}

/**
 * Builds the per-line substitution. `budget` caps how many replacements the
 * whole run may still make, so a global substitution can be cut mid-line and
 * the rest of the document copied verbatim.
 */
function createSubstituter(
  pattern: string,
  replacement: string,
  options: SedOptions
): (text: string, budget: number) => LineSubstitution {
  const flags = `${options.global ? "g" : ""}${options.ignoreCase ? "i" : ""}`;

  let regex: RegExp;

  if (options.fixedString) {
    if (pattern.length === 0) {
      throw new TaskInvalidInputError("pattern must not be empty when fixedString is set");
    }
    regex = new RegExp(escapeRegExp(pattern), flags);
  } else {
    assertSafeRegexPattern(pattern);
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      throw new TaskInvalidInputError(`Invalid regular expression: ${pattern}`);
    }
  }

  // A literal replacement must not be re-read for `$1` / `$&` expansion.
  const substitute: (args: unknown[]) => string = options.fixedString
    ? () => replacement
    : (args) => expandReplacement(replacement, args);

  return (text, budget) => {
    let replacements = 0;

    const result = text.replace(regex, (...args: unknown[]): string => {
      if (replacements >= budget) {
        return args[0] as string;
      }
      replacements++;
      return substitute(args);
    });

    return { text: result, replacements };
  };
}

/**
 * `String.replace` only expands `$n` when handed a string, and a callback is
 * what bounds the substitution count — so the expansion is done here instead.
 */
function expandReplacement(replacement: string, args: unknown[]): string {
  if (!replacement.includes("$")) {
    return replacement;
  }

  const match = args[0] as string;

  // Trailing args are the offset, the subject, and optionally the named groups.
  const hasNamed = typeof args[args.length - 1] === "object";
  const end = hasNamed ? args.length - 1 : args.length;
  const groups = args.slice(1, end - 2) as Array<string | undefined>;
  const named = hasNamed
    ? (args[args.length - 1] as Record<string, string | undefined>)
    : undefined;

  let out = "";

  // Latched once no '>' remains: the scan index only grows, so a failed search
  // can never succeed later, and re-searching would make this quadratic on a
  // replacement of unterminated `$<`.
  let mayHaveGroupName = true;

  for (let index = 0; index < replacement.length; index++) {
    const char = replacement[index];
    const next = replacement[index + 1];

    if (char !== "$" || next === undefined) {
      out += char;
      continue;
    }

    if (next === "$") {
      out += "$";
      index++;
      continue;
    }

    if (next === "&") {
      out += match;
      index++;
      continue;
    }

    if (next === "<") {
      const close = mayHaveGroupName ? replacement.indexOf(">", index + 2) : -1;
      if (close === -1) {
        mayHaveGroupName = false;
        out += char;
        continue;
      }
      out += named?.[replacement.slice(index + 2, close)] ?? "";
      index = close;
      continue;
    }

    if (next >= "0" && next <= "9") {
      let selector = next;

      // A two-digit reference wins only when that group actually exists.
      const after = replacement[index + 2];
      if (after !== undefined && after >= "0" && after <= "9") {
        if (Number(next + after) <= groups.length) {
          selector = next + after;
        }
      }

      const group = Number(selector);

      if (group < 1 || group > groups.length) {
        out += char;
        continue;
      }

      out += groups[group - 1] ?? "";
      index += selector.length;
      continue;
    }

    out += char;
  }

  return out;
}

export async function sedLines(
  lines: AsyncIterable<string>,
  pattern: string,
  replacement: string,
  options: SedOptions = {},
  signal?: AbortSignal
): Promise<FileSedTaskOutput> {
  validateOptions(options);

  const substituter = createSubstituter(pattern, replacement, options);

  const out: string[] = [];

  let replacementCount = 0;
  let linesChanged = 0;
  let truncated = false;

  let outputLines = 0;
  let outputChars = 0;

  for await (const text of lines) {
    if (signal?.aborted) {
      throw new TaskAbortedError("Task aborted");
    }

    const budget =
      options.maxReplacements === undefined
        ? Number.POSITIVE_INFINITY
        : options.maxReplacements - replacementCount;

    const { text: replaced, replacements } =
      budget > 0 ? substituter(text, budget) : { text, replacements: 0 };

    replacementCount += replacements;
    if (replacements > 0) {
      linesChanged++;
    }

    if (options.onlyChangedLines && replacements === 0) {
      continue;
    }

    if (options.maxOutputLines !== undefined && outputLines >= options.maxOutputLines) {
      truncated = true;
      break;
    }

    const chars = replaced.length + 1;

    if (options.maxOutputChars !== undefined && outputChars + chars > options.maxOutputChars) {
      truncated = true;
      break;
    }

    out.push(replaced);
    outputLines++;
    outputChars += chars;
  }

  return {
    text: out.length === 0 ? "" : `${out.join("\n")}\n`,
    replacementCount,
    linesChanged,
    truncated,
  };
}

/**
 * Task for substituting text in documents from URLs (including file:// URLs).
 * Works in all environments (browser, Node.js, Bun) by using fetch API.
 * For server-only filesystem path access, see FileSedTask.server.
 *
 * The source is never modified: the transformed document is returned as output.
 */
export class FileSedTask extends Task<FileSedTaskInput, FileSedTaskOutput, TaskConfig> {
  public static override type = "FileSedTask";
  public static override category = "Document";
  public static override title = "File Sed";
  public static override description = "Substitute matching text in a file (sed)";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: FileSedTaskInput,
    context: IExecuteContext
  ): Promise<FileSedTaskOutput> {
    const { url, pattern, replacement, ...options } = input;

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(0, "Fetching file");

    const fetchTask = context.own(new FetchUrlTask({ queue: false }));
    const response = await fetchTask.run({
      url,
      response_type: "text",
    });

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(60, "Substituting text");

    const result = await sedLines(
      linesFromText(response.text ?? ""),
      pattern,
      replacement,
      options,
      context.signal
    );

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(100, "Substitution complete");

    return result;
  }
}

export const fileSed = (input: FileSedTaskInput, config?: TaskConfig) => {
  return new FileSedTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fileSed: CreateWorkflow<FileSedTaskInput, FileSedTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.fileSed = CreateWorkflow(FileSedTask);
