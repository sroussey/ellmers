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
  TaskEntitlementError,
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
   * Declares whichever half of the surface this url actually uses: the fetch
   * entitlements for http(s), otherwise `filesystem:read` scoped to the
   * resolved real path. An unknown url fails closed to both, unscoped.
   *
   * Never throws — entitlement evaluation runs before `execute()` and must
   * produce a declaration for any input, so an unresolvable path degrades to
   * the unscoped declaration and is refused later, at open time.
   */
  public override entitlements(): TaskEntitlements {
    const url = this.runInputData?.url;
    const unscopedRead: TaskEntitlements = {
      entitlements: [{ id: Entitlements.FILESYSTEM_READ, reason: "Reads a local file from disk" }],
    };

    if (typeof url !== "string" || url.length === 0) {
      return mergeEntitlements(super.entitlements(), unscopedRead);
    }

    if (isHttpUrl(url)) {
      return super.entitlements();
    }

    try {
      return {
        entitlements: [
          {
            id: Entitlements.FILESYSTEM_READ,
            reason: "Reads a local file from disk",
            resources: [resolveLocalFilePath(url, { roots: this.config.roots })],
          },
        ],
      };
    } catch {
      return unscopedRead;
    }
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

  /**
   * Refuses a path the instance did not declare. Entitlements are evaluated
   * on the unresolved input, so without this a declare-then-swap would let the
   * open authorize itself — and a standalone `fileGrep(...)` with no graph and
   * no enforcer would honour no `roots` at all.
   */
  private assertResolvedPathDeclared(file: string): void {
    const declared = this.entitlements().entitlements.find(
      (entitlement) => entitlement.id === Entitlements.FILESYSTEM_READ
    );
    if (declared?.resources === undefined) {
      throw new TaskEntitlementError(
        `Refusing to read ${file}: the path could not be resolved when entitlements were declared`
      );
    }
    if (!declared.resources.includes(file)) {
      throw new TaskEntitlementError(
        `Refusing to read ${file}: it differs from the declared path ${declared.resources.join(", ")}`
      );
    }
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
    this.assertResolvedPathDeclared(file);

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
