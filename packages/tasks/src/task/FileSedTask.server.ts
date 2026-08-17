/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskEntitlements } from "@workglow/task-graph";
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
import { createBoundedRegexReplacer } from "../util/BoundedRegex.server";
import { isHttpUrl, resolveLocalFilePath } from "../util/LocalFilePath.server";
import type {
  FileSedTaskConfig,
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

export type { FileSedTaskConfig, FileSedTaskInput, FileSedTaskOutput };

const fileSedTaskConfigSchema = {
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
 * Server-only task for substituting text in files on the filesystem, on top of
 * the base task's http(s) handling.
 *
 * The file is streamed line-by-line rather than loaded into memory, and the
 * file on disk is never modified — there is no in-place (`sed -i`) mode.
 *
 * A local path is resolved and realpath'd before it is opened, and constrained
 * to `config.roots` when the embedder sets them. Reading requires the
 * `filesystem:read` entitlement.
 *
 * Only available in Node.js and Bun environments. For cross-platform
 * substitution (including browser), use FileSedTask with an http(s) URL.
 */
export class FileSedTask extends BaseFileSedTask<FileSedTaskConfig> {
  public static override configSchema(): DataPortSchema {
    return fileSedTaskConfigSchema as DataPortSchema;
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
    const { url, pattern, replacement, ...options } = input;

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
    await context.updateProgress(10, "Substituting text");

    const result = await sedFile(
      file,
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

export const fileSed = (input: FileSedTaskInput, config?: FileSedTaskConfig) => {
  return new FileSedTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fileSed: CreateWorkflow<FileSedTaskInput, FileSedTaskOutput, FileSedTaskConfig>;
  }
}

Workflow.prototype.fileSed = CreateWorkflow(FileSedTask);
