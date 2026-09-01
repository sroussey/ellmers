/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

import "./codec.node";
import "./task/image/registerImageTextRenderer.node";
import "./util/SafeFetch.server";
import "./util/BoundedRegex.server";

export * from "./common";
export * from "./task/FileGrepTask.server";
export { createMatcher, grepLines, linesFromText } from "./task/FileGrepTask";
export type { GrepLineMatcher, GrepOptions } from "./task/FileGrepTask";
export * from "./task/FileLoaderTask.server";
export * from "./task/FileSedTask.server";
export {
  createSedExpander,
  createSedRegex,
  createSubstituter,
  expandReplacement,
  sedLines,
} from "./task/FileSedTask";
export type { SedBatchResult, SedLineSubstituter, SedOptions } from "./task/FileSedTask";

import type { ITaskConstructor } from "@workglow/task-graph";
import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import type { RegisterCommonTasksOptions } from "./registerTaskOptions";
import { FileGrepTask } from "./task/FileGrepTask.server";
import { FileLoaderTask } from "./task/FileLoaderTask.server";
import { FileSedTask } from "./task/FileSedTask.server";

/**
 * Adds the filesystem tasks to the ambient registry, making them resolvable by
 * type name — including from graph JSON the host did not author.
 *
 * Call it only where every graph that can reach the registry is trusted. Each
 * task still contains reads to its `config.roots`, which defaults to
 * `process.cwd()`, but a serialized node supplies its own config: registration
 * is the boundary, containment is the backstop behind it.
 */
export const registerFileSystemTasks = (): ITaskConstructor<any, any, any>[] => {
  TaskRegistry.registerTask(FileGrepTask);
  TaskRegistry.registerTask(FileLoaderTask);
  TaskRegistry.registerTask(FileSedTask);
  return [FileGrepTask, FileLoaderTask, FileSedTask];
};

/**
 * Registers the utility tasks, and the filesystem tasks when the host asks for
 * them — see {@link RegisterCommonTasksOptions.fileSystemTasks}.
 *
 * The classes are exported whichever way the flag goes, so constructing one
 * directly is never affected; only resolution by type name is.
 */
export const registerCommonTasks = (
  options: RegisterCommonTasksOptions
): ITaskConstructor<any, any, any>[] => {
  const tasks: ITaskConstructor<any, any, any>[] = [...registerCommonTasksFn()];
  if (options.fileSystemTasks) tasks.push(...registerFileSystemTasks());
  return tasks;
};
