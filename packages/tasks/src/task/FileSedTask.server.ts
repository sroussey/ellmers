/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, TaskAbortedError, Workflow } from "@workglow/task-graph";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { SECURITY_LIMITS } from "@workglow/util";
import { createBoundedRegexReplacer } from "../util/BoundedRegex.server";
import type {
  FileSedTaskInput,
  FileSedTaskOutput,
  SedLineSubstituter,
  SedOptions,
} from "./FileSedTask";
import {
  FileSedTask as BaseFileSedTask,
  createSedExpander,
  createSedRegex,
  sedLines,
} from "./FileSedTask";

export type { FileSedTaskInput, FileSedTaskOutput };

/**
 * Server-only task for substituting text in files on the filesystem.
 * Streams the file line-by-line rather than loading it into memory.
 * Only available in Node.js and Bun environments.
 *
 * The file on disk is never modified — there is no in-place (`sed -i`) mode.
 *
 * For cross-platform substitution (including browser), use FileSedTask with URLs.
 */
export class FileSedTask extends BaseFileSedTask {
  /**
   * Runs the substitution inside a `vm` context under a wall-clock budget, so
   * a catastrophically backtracking pattern fails instead of wedging the event
   * loop. Overriding here covers both branches: the http branch reaches
   * `super.execute`, which uses the substituter this returns.
   *
   * `fixedString` never enters `vm` — an escaped literal cannot backtrack, and
   * the `vm` hop would cost ~4x for nothing.
   */
  protected override createSubstituter(
    pattern: string,
    replacement: string,
    options: SedOptions
  ): SedLineSubstituter {
    if (options.fixedString) {
      return super.createSubstituter(pattern, replacement, options);
    }

    const regex = createSedRegex(pattern, options);
    const substituteBatch = createBoundedRegexReplacer(
      regex,
      createSedExpander(replacement, options),
      SECURITY_LIMITS.regexMatchBatchTimeoutMs
    );
    return { substituteBatch };
  }

  override async execute(
    input: FileSedTaskInput,
    context: IExecuteContext
  ): Promise<FileSedTaskOutput> {
    let { url, pattern, replacement, ...options } = input;

    if (url.startsWith("http://") || url.startsWith("https://")) {
      return super.execute(input, context);
    }

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(0, "Opening file");

    if (url.startsWith("file://")) {
      url = url.slice(7);
    }

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(10, "Substituting text");

    const result = await sedFile(
      url,
      pattern,
      replacement,
      options,
      context.signal,
      this.createSubstituter(pattern, replacement, options)
    );

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(100, "Substitution complete");

    return result;
  }
}

async function sedFile(
  file: string,
  pattern: string,
  replacement: string,
  options: SedOptions,
  signal: AbortSignal,
  substituter: SedLineSubstituter
): Promise<FileSedTaskOutput> {
  const input = createReadStream(file, { signal });
  const rl = createInterface({
    input,
    crlfDelay: Infinity,
  });

  try {
    return await sedLines(rl, pattern, replacement, options, signal, substituter);
  } catch (err) {
    if (signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    throw err;
  } finally {
    rl.close();
    input.destroy();
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
