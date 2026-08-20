/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

import "./codec.node";
import "./task/image/registerImageTextRenderer.node";
import "./util/SafeFetch.server";

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

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileGrepTask } from "./task/FileGrepTask.server";
import { FileLoaderTask } from "./task/FileLoaderTask.server";
import { FileSedTask } from "./task/FileSedTask.server";

/**
 * Registers the tasks that are safe to have in the ambient registry on a
 * server.
 *
 * The three filesystem tasks are NOT among them, and their absence is the
 * point. `TaskRegistry` is what a deserialized graph resolves a task type
 * through, and a serialized node carries its own `config` — so a graph that
 * names `FileGrepTask` also states its own `roots`, and no default this
 * package picks can constrain it. The only control that survives untrusted
 * JSON is the task not being resolvable at all.
 *
 * A host that intends to expose them opts in with
 * {@link registerFileSystemTasks}. The classes are exported either way, so
 * constructing one directly is unchanged.
 */
export const registerCommonTasks = () => {
  return registerCommonTasksFn();
};

/**
 * Adds the filesystem tasks to the ambient registry, making them resolvable by
 * type name — including from graph JSON the host did not author.
 *
 * Call it only where every graph that can reach the registry is trusted. Each
 * task still contains reads to its `config.roots`, which defaults to
 * `process.cwd()`, but a serialized node supplies its own config: registration
 * is the boundary, containment is the backstop behind it.
 */
export const registerFileSystemTasks = () => {
  TaskRegistry.registerTask(FileGrepTask);
  TaskRegistry.registerTask(FileLoaderTask);
  TaskRegistry.registerTask(FileSedTask);
  return [FileGrepTask, FileLoaderTask, FileSedTask];
};
