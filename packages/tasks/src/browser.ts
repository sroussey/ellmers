/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

import "./codec.browser";
import "./task/image/registerImageTextRenderer.browser";

export * from "./common";
export * from "./task/FileGrepTask";
export * from "./task/FileLoaderTask";
export * from "./task/FileSedTask";

import type { ITaskConstructor } from "@workglow/task-graph";
import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import type { RegisterCommonTasksOptions } from "./registerTaskOptions";
import { FileGrepTask } from "./task/FileGrepTask";
import { FileLoaderTask } from "./task/FileLoaderTask";
import { FileSedTask } from "./task/FileSedTask";

/**
 * The browser filesystem tasks read through whatever `url` resolves to in the
 * page, so there is no ambient disk for them to reach — but the registry is
 * still what stored graph JSON resolves a type name through, and a host that
 * ships this entry and the node one must not get two different surfaces from
 * the same call.
 */
export const registerFileSystemTasks = (): ITaskConstructor<any, any, any>[] => {
  TaskRegistry.registerTask(FileGrepTask);
  TaskRegistry.registerTask(FileLoaderTask);
  TaskRegistry.registerTask(FileSedTask);
  return [FileGrepTask, FileLoaderTask, FileSedTask];
};

export const registerCommonTasks = (
  options: RegisterCommonTasksOptions
): ITaskConstructor<any, any, any>[] => {
  const tasks: ITaskConstructor<any, any, any>[] = [...registerCommonTasksFn()];
  if (options.fileSystemTasks) tasks.push(...registerFileSystemTasks());
  return tasks;
};
