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
import { DEFAULT_LIMITS, SECURITY_LIMITS } from "@workglow/util";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { compileSafeRegex, escapeRegExp } from "../util/regexSafety";
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
    onlyMatching: {
      type: "boolean",
      title: "Only Matching",
      description: "Emit the matched substrings instead of whole lines, one per match (-o)",
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

export type GrepOptions = Omit<FileGrepTaskInput, "url" | "pattern">;

/**
 * Matches a batch of lines at once. Batching is what makes an interruptible
 * matcher affordable — see `createBoundedRegexMatcher` on the server build,
 * whose per-call cost only amortizes over a batch.
 */
export interface GrepLineMatcher {
  readonly matchBatch: (texts: readonly string[]) => boolean[];
}

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

export function createMatcher(pattern: string, options: GrepOptions): GrepLineMatcher {
  if (options.fixedString) {
    if (options.ignoreCase) {
      const needle = pattern.toLowerCase();
      return { matchBatch: (texts) => texts.map((t) => t.toLowerCase().includes(needle)) };
    }
    return { matchBatch: (texts) => texts.map((t) => t.includes(pattern)) };
  }

  const regex = compileSafeRegex(pattern, options.ignoreCase ? "i" : "");
  return { matchBatch: (texts) => texts.map((t) => regex.test(t)) };
}

/**
 * Collects the matched substrings of a line for `onlyMatching`. A literal
 * pattern is compiled rather than searched with `indexOf` so that an
 * ignore-case match can be sliced out of the original text: `toLowerCase()`
 * is not length-preserving for every character, so lowercasing the haystack
 * to find an offset can misalign the slice back in the original.
 */
function createExtractor(pattern: string, options: GrepOptions): (text: string) => string[] {
  const source = options.fixedString ? escapeRegExp(pattern) : pattern;

  if (!options.fixedString) {
    assertSafeRegexPattern(pattern);
  }

  let regex: RegExp;
  try {
    regex = new RegExp(source, options.ignoreCase ? "gi" : "g");
  } catch {
    throw new TaskInvalidInputError(`Invalid regular expression: ${pattern}`);
  }

  return (text) => {
    const matches: string[] = [];

    regex.lastIndex = 0;

    let result: RegExpExecArray | null;
    while ((result = regex.exec(text)) !== null) {
      // grep skips a zero-length match; advancing is also what ends the loop.
      if (result[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      matches.push(result[0]);
    }

    return matches;
  };
}

/**
 * Scans `lines`, matching in batches of {@link SECURITY_LIMITS.regexMatchBatchLines}.
 *
 * Abort and the overall search deadline are checked once per BATCH, not per
 * line: a single `regex.test` is uninterruptible, so per-line checks bought
 * nothing a hostile pattern could not ignore. The granularity that matters is
 * therefore the batch, and the matcher itself bounds how long one batch may run.
 */
export async function grepLines(
  lines: AsyncIterable<string>,
  pattern: string,
  options: GrepOptions = {},
  signal?: AbortSignal,
  matcher?: GrepLineMatcher | undefined
): Promise<FileGrepTaskOutput> {
  validateOptions(options);

  // Context is inert under onlyMatching: a context line holds no match, so
  // grep prints nothing for it, and carrying a window would only let two
  // matches separated by unprinted lines land in one group.
  const beforeContext = options.onlyMatching ? 0 : (options.context ?? options.beforeContext ?? 0);
  const afterContext = options.onlyMatching ? 0 : (options.context ?? options.afterContext ?? 0);

  const lineMatcher = matcher ?? createMatcher(pattern, options);
  const extract =
    options.onlyMatching && !options.existsOnly && !options.countOnly
      ? createExtractor(pattern, options)
      : undefined;

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
      // De-duplication exists to merge a before-context line already emitted as
      // after-context. Under onlyMatching one line legitimately yields several
      // entries, so merging them would collapse repeated matches into one.
      const existing = options.onlyMatching
        ? undefined
        : currentGroup.lines.find((line) => line.line === entry.line);

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

  const iterator = lines[Symbol.asyncIterator]();
  const deadline = Date.now() + DEFAULT_LIMITS.grepMaxSearchMs;
  const batch: string[] = [];
  let exhausted = false;

  try {
    outer: while (!exhausted) {
      batch.length = 0;
      while (batch.length < SECURITY_LIMITS.regexMatchBatchLines) {
        const next = await iterator.next();
        if (next.done === true) {
          exhausted = true;
          break;
        }
        batch.push(next.value);
      }

      if (batch.length === 0) break;

      if (signal?.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      if (Date.now() > deadline) {
        truncated = true;
        break;
      }

      const flags = lineMatcher.matchBatch(batch);

      for (let i = 0; i < batch.length; i++) {
        const text = batch[i]!;

        lineNumber++;

        let matched = flags[i]!;

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

          if (extract) {
            // An inverted selection reaches here on a line the pattern did NOT
            // match, so the extractor finds nothing and emits nothing — which is
            // exactly what `grep -v -o` prints.
            for (const match of extract(text)) {
              if (!emitLine({ line: lineNumber, text: match, match: true })) {
                return {
                  groups,
                  matchCount,
                  exists,
                  truncated: true,
                };
              }
            }
          } else if (!options.countOnly) {
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
              break outer;
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
            break outer;
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
    }
  } finally {
    await iterator.return?.();
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

  /**
   * Seam for the matcher the scan runs. The server build overrides it to bound
   * regex matching with an interruptible time budget; there is no `vm` in a
   * browser, so a hostile pattern there still blocks that tab (a tab — not the
   * process hosting a local API).
   */
  protected createLineMatcher(pattern: string, options: GrepOptions): GrepLineMatcher {
    return createMatcher(pattern, options);
  }

  override async execute(
    input: FileGrepTaskInput,
    context: IExecuteContext
  ): Promise<FileGrepTaskOutput> {
    const { url, pattern, ...options } = input;

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }

    // Compiled before the fetch so a rejected pattern costs no network call.
    const matcher = this.createLineMatcher(pattern, options);

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
      context.signal,
      matcher
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
