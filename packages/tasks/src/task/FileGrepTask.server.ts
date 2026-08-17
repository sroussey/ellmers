/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskConfig, TaskEntitlements } from "@workglow/task-graph";
import {
  CreateWorkflow,
  Entitlements,
  mergeEntitlements,
  TaskAbortedError,
  TaskConfigSchema,
  Workflow,
} from "@workglow/task-graph";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { SECURITY_LIMITS } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { createBoundedRegexMatcher } from "../util/BoundedRegex.server";
import { isHttpUrl, resolveLocalFilePath } from "../util/LocalFilePath.server";
import { compileSafeRegex } from "../util/RegexSafety";
import type {
  FileGrepTaskInput,
  FileGrepTaskOutput,
  GrepLineMatcher,
  GrepOptions,
} from "./FileGrepTask";
import { FileGrepTask as BaseFileGrepTask, grepLines } from "./FileGrepTask";

export type { FileGrepTaskInput, FileGrepTaskOutput };

export interface FileGrepTaskConfig extends TaskConfig {
  /**
   * Directories a local path must resolve inside, checked after symlinks are
   * resolved. Omitted means unrestricted: the enforced control is the
   * `filesystem:read` entitlement, and this is the embedder's extra fence.
   */
  readonly roots?: readonly string[] | undefined;
}

const fileGrepTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    roots: {
      type: "array",
      items: { type: "string" },
      title: "Roots",
      description: "Directories a local path must resolve inside (after symlink resolution)",
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Server-only task for grepping documents from the filesystem.
 * Streams the file line-by-line rather than loading it into memory.
 * Only available in Node.js and Bun environments.
 *
 * For cross-platform grep (including browser), use FileGrepTask with URLs.
 */
export class FileGrepTask extends BaseFileGrepTask<FileGrepTaskConfig> {
  public static override configSchema(): DataPortSchema {
    return fileGrepTaskConfigSchema as DataPortSchema;
  }

  public static override entitlements(): TaskEntitlements {
    return mergeEntitlements(super.entitlements(), {
      entitlements: [
        {
          id: Entitlements.FILESYSTEM_READ,
          reason: "Reads a local file or file:// URL from disk",
        },
      ],
    });
  }

  /**
   * Runs regex matching inside a `vm` context under a wall-clock budget, so a
   * catastrophically backtracking pattern fails instead of wedging the event
   * loop. Overriding here covers both branches: the http branch reaches
   * `super.execute`, which uses the matcher this returns.
   *
   * `fixedString` never enters `vm` — `String.includes` cannot backtrack, and
   * the `vm` hop would cost ~20x for nothing.
   */
  protected override createLineMatcher(pattern: string, options: GrepOptions): GrepLineMatcher {
    if (options.fixedString) {
      return super.createLineMatcher(pattern, options);
    }

    const regex = compileSafeRegex(pattern, options.ignoreCase ? "i" : "");
    const matchBatch = createBoundedRegexMatcher(regex, SECURITY_LIMITS.regexMatchBatchTimeoutMs);
    return { matchBatch };
  }

  override async execute(
    input: FileGrepTaskInput,
    context: IExecuteContext
  ): Promise<FileGrepTaskOutput> {
    const { url, pattern, ...options } = input;

    if (isHttpUrl(url)) {
      return super.execute(input, context);
    }

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(0, "Opening file");

    const file = resolveLocalFilePath(url, { roots: this.config.roots });

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(10, "Searching file");

    const result = await grepFile(
      file,
      pattern,
      options,
      context.signal,
      this.createLineMatcher(pattern, options)
    );

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
  options: GrepOptions,
  signal: AbortSignal,
  matcher: GrepLineMatcher
): Promise<FileGrepTaskOutput> {
  const input = createReadStream(file, { signal });
  const rl = createInterface({
    input,
    crlfDelay: Infinity,
  });

  try {
    return await grepLines(rl, pattern, options, signal, matcher);
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

export const fileGrep = (input: FileGrepTaskInput, config?: FileGrepTaskConfig) => {
  return new FileGrepTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fileGrep: CreateWorkflow<FileGrepTaskInput, FileGrepTaskOutput, FileGrepTaskConfig>;
  }
}

Workflow.prototype.fileGrep = CreateWorkflow(FileGrepTask);
