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
import { assertSafeRegexPattern } from "../util/regexSafety";
import { linesFromText } from "../util/textLines";
import { FetchUrlTask } from "./FetchUrlTask";

export { linesFromText };

const inputSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      title: "URL",
      description: "URL to search (http://, https://)",
      format: "uri",
    },
    pattern: {
      type: "string",
      title: "Pattern",
      description: "Regular expression, or a literal string when fixedString is set",
    },
    ignoreCase: {
      type: "boolean",
      title: "Ignore Case",
      description: "Case-insensitive matching (-i)",
    },
    fixedString: {
      type: "boolean",
      title: "Fixed String",
      description: "Treat pattern as a literal string (-F)",
    },
    invertMatch: {
      type: "boolean",
      title: "Invert Match",
      description: "Select lines that do not match (-v)",
    },
    afterContext: {
      type: "integer",
      title: "After Context",
      description: "Lines after each match (-A)",
      minimum: 0,
    },
    beforeContext: {
      type: "integer",
      title: "Before Context",
      description: "Lines before each match (-B)",
      minimum: 0,
    },
    context: {
      type: "integer",
      title: "Context",
      description: "Lines before and after each match (-C)",
      minimum: 0,
    },
    maxMatches: {
      type: "integer",
      title: "Max Matches",
      description: "Stop after this many matching lines (-m)",
      minimum: 1,
    },
    existsOnly: {
      type: "boolean",
      title: "Exists Only",
      description: "Return only whether a match exists (-q-like behavior)",
    },
    countOnly: {
      type: "boolean",
      title: "Count Only",
      description: "Return only the number of matching lines (-c-like behavior)",
    },
    maxOutputLines: {
      type: "integer",
      title: "Max Output Lines",
      description: "Maximum number of output lines, including context",
      minimum: 0,
    },
    maxOutputChars: {
      type: "integer",
      title: "Max Output Characters",
      description: "Maximum number of output characters, including newlines",
      minimum: 0,
    },
  },
  required: ["url", "pattern"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const grepLineSchema = {
  type: "object",
  properties: {
    line: { type: "integer", title: "Line", description: "1-based line number" },
    text: { type: "string", title: "Text", description: "Line contents without the terminator" },
    match: {
      type: "boolean",
      title: "Match",
      description: "Whether this line matched the pattern",
    },
  },
  required: ["line", "text", "match"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      title: "Groups",
      description: "Contiguous match groups, including context lines",
      items: {
        type: "object",
        properties: {
          startLine: { type: "integer", title: "Start Line" },
          endLine: { type: "integer", title: "End Line" },
          lines: {
            type: "array",
            items: grepLineSchema,
          },
        },
        required: ["startLine", "endLine", "lines"],
        additionalProperties: false,
      },
    },
    matchCount: {
      type: "integer",
      title: "Match Count",
      description: "Number of matching lines",
    },
    exists: {
      type: "boolean",
      title: "Exists",
      description: "Whether any line matched",
    },
    truncated: {
      type: "boolean",
      title: "Truncated",
      description: "Search stopped before EOF because of an output or search limit",
    },
  },
  required: ["groups", "matchCount", "exists", "truncated"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FileGrepTaskInput = FromSchema<typeof inputSchema>;
export type FileGrepTaskOutput = FromSchema<typeof outputSchema>;

interface GrepLine {
  line: number;
  text: string;
  match: boolean;
}

interface GrepGroup {
  startLine: number;
  endLine: number;
  lines: GrepLine[];
}

type GrepOptions = Omit<FileGrepTaskInput, "url" | "pattern">;

interface BufferedLine {
  readonly line: number;
  readonly text: string;
}

function validateOptions(options: GrepOptions): void {
  const integerOptions: Array<[keyof GrepOptions, number | undefined]> = [
    ["afterContext", options.afterContext],
    ["beforeContext", options.beforeContext],
    ["context", options.context],
    ["maxMatches", options.maxMatches],
    ["maxOutputLines", options.maxOutputLines],
    ["maxOutputChars", options.maxOutputChars],
  ];

  for (const [name, value] of integerOptions) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new TaskInvalidInputError(`${String(name)} must be a non-negative integer`);
    }
  }

  if (options.maxMatches === 0) {
    throw new TaskInvalidInputError("maxMatches must be greater than zero when specified");
  }
}

function createMatcher(pattern: string, options: GrepOptions): (text: string) => boolean {
  if (options.fixedString) {
    if (options.ignoreCase) {
      const needle = pattern.toLowerCase();
      return (text) => text.toLowerCase().includes(needle);
    }
    return (text) => text.includes(pattern);
  }

  assertSafeRegexPattern(pattern);

  try {
    const regex = new RegExp(pattern, options.ignoreCase ? "i" : "");
    return (text) => regex.test(text);
  } catch {
    throw new TaskInvalidInputError(`Invalid regular expression: ${pattern}`);
  }
}

export async function grepLines(
  lines: AsyncIterable<string>,
  pattern: string,
  options: GrepOptions = {},
  signal?: AbortSignal
): Promise<FileGrepTaskOutput> {
  validateOptions(options);

  const beforeContext = options.context ?? options.beforeContext ?? 0;
  const afterContext = options.context ?? options.afterContext ?? 0;

  const matcher = createMatcher(pattern, options);

  const groups: GrepGroup[] = [];
  const beforeBuffer: BufferedLine[] = [];

  let currentGroup: GrepGroup | undefined;

  let lineNumber = 0;
  let matchCount = 0;
  let exists = false;
  let truncated = false;

  let afterRemaining = 0;
  let maxMatchesReached = false;

  let outputLines = 0;
  let outputChars = 0;

  function canEmit(text: string): boolean {
    if (options.maxOutputLines !== undefined && outputLines >= options.maxOutputLines) {
      return false;
    }

    const chars = text.length + 1;

    if (options.maxOutputChars !== undefined && outputChars + chars > options.maxOutputChars) {
      return false;
    }

    return true;
  }

  function emitLine(entry: GrepLine): boolean {
    if (!canEmit(entry.text)) {
      truncated = true;
      return false;
    }

    if (currentGroup && entry.line <= currentGroup.endLine + 1) {
      const existing = currentGroup.lines.find((line) => line.line === entry.line);

      if (existing) {
        if (entry.match) {
          existing.match = true;
        }

        return true;
      }

      currentGroup.lines.push(entry);
      currentGroup.endLine = entry.line;
    } else {
      currentGroup = {
        startLine: entry.line,
        endLine: entry.line,
        lines: [entry],
      };

      groups.push(currentGroup);
    }

    outputLines++;
    outputChars += entry.text.length + 1;

    return true;
  }

  for await (const text of lines) {
    if (signal?.aborted) {
      throw new TaskAbortedError("Task aborted");
    }

    lineNumber++;

    let matched = matcher(text);

    if (options.invertMatch) {
      matched = !matched;
    }

    if (matched && !maxMatchesReached) {
      matchCount++;
      exists = true;

      if (options.existsOnly) {
        return {
          groups: [],
          matchCount: 1,
          exists: true,
          truncated: false,
        };
      }

      if (!options.countOnly) {
        for (const previous of beforeBuffer) {
          if (
            !emitLine({
              line: previous.line,
              text: previous.text,
              match: false,
            })
          ) {
            return {
              groups,
              matchCount,
              exists,
              truncated: true,
            };
          }
        }

        if (
          !emitLine({
            line: lineNumber,
            text,
            match: true,
          })
        ) {
          return {
            groups,
            matchCount,
            exists,
            truncated: true,
          };
        }
      }

      afterRemaining = afterContext;

      if (options.maxMatches !== undefined && matchCount >= options.maxMatches) {
        maxMatchesReached = true;

        if (afterContext === 0) {
          truncated = true;
          break;
        }
      }
    } else if (!options.countOnly && afterRemaining > 0) {
      if (
        !emitLine({
          line: lineNumber,
          text,
          match: false,
        })
      ) {
        return {
          groups,
          matchCount,
          exists,
          truncated: true,
        };
      }

      afterRemaining--;
    }

    beforeBuffer.push({
      line: lineNumber,
      text,
    });

    if (beforeBuffer.length > beforeContext) {
      beforeBuffer.shift();
    }

    if (maxMatchesReached) {
      if (afterRemaining === 0) {
        truncated = true;
        break;
      }

      continue;
    }

    /*
     * A non-matching line outside trailing context means any future
     * match is separated from the current group.
     */
    if (!matched && afterRemaining === 0) {
      currentGroup = undefined;
    }
  }

  return {
    groups: options.countOnly ? [] : groups,
    matchCount,
    exists,
    truncated,
  };
}

/**
 * Task for grepping documents from URLs (including file:// URLs).
 * Works in all environments (browser, Node.js, Bun) by using fetch API.
 * For server-only filesystem path access, see FileGrepTask.server.
 */
export class FileGrepTask extends Task<FileGrepTaskInput, FileGrepTaskOutput, TaskConfig> {
  public static override type = "FileGrepTask";
  public static override category = "Document";
  public static override title = "File Grep";
  public static override description = "Search a file for matching lines (grep)";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: FileGrepTaskInput,
    context: IExecuteContext
  ): Promise<FileGrepTaskOutput> {
    const { url, pattern, ...options } = input;

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
    await context.updateProgress(60, "Searching file");

    const result = await grepLines(
      linesFromText(response.text ?? ""),
      pattern,
      options,
      context.signal
    );

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(100, "Search complete");

    return result;
  }
}

export const fileGrep = (input: FileGrepTaskInput, config?: TaskConfig) => {
  return new FileGrepTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fileGrep: CreateWorkflow<FileGrepTaskInput, FileGrepTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.fileGrep = CreateWorkflow(FileGrepTask);
