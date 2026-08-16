/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, TaskAbortedError, Workflow } from "@workglow/task-graph";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type { FileGrepTaskInput, FileGrepTaskOutput } from "./FileGrepTask";
import { FileGrepTask as BaseFileGrepTask, grepLines } from "./FileGrepTask";

export type { FileGrepTaskInput, FileGrepTaskOutput };

/**
 * Server-only task for grepping documents from the filesystem.
 * Streams the file line-by-line rather than loading it into memory.
 * Only available in Node.js and Bun environments.
 *
 * For cross-platform grep (including browser), use FileGrepTask with URLs.
 */
export class FileGrepTask extends BaseFileGrepTask {
  override async execute(
    input: FileGrepTaskInput,
    context: IExecuteContext
  ): Promise<FileGrepTaskOutput> {
    let { url, pattern, ...options } = input;

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
    await context.updateProgress(10, "Searching file");

    const result = await grepFile(url, pattern, options, context.signal);

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(100, "Search complete");

    return result;
  }
}

async function grepFile(
  file: string,
  pattern: string,
  options: Omit<FileGrepTaskInput, "url" | "pattern">,
  signal: AbortSignal
): Promise<FileGrepTaskOutput> {
  const input = createReadStream(file, { signal });
  const rl = createInterface({
    input,
    crlfDelay: Infinity,
  });

  try {
    return await grepLines(rl, pattern, options, signal);
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

export const fileGrep = (input: FileGrepTaskInput, config?: TaskConfig) => {
  return new FileGrepTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fileGrep: CreateWorkflow<FileGrepTaskInput, FileGrepTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.fileGrep = CreateWorkflow(FileGrepTask);
