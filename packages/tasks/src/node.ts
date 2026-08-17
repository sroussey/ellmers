/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

import "./codec.node";
import "./task/image/registerImageTextRenderer.node";
// Install the DNS-resolving, connection-pinning SafeFetch implementation.
// This side-effect import must happen before FetchUrlTask is used.
import "./util/SafeFetch.server";

export * from "./common";
export * from "./task/FileGrepTask.server";
export { grepLines, linesFromText } from "./task/FileGrepTask";
export * from "./task/FileLoaderTask.server";
export * from "./task/FileSedTask.server";

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileGrepTask } from "./task/FileGrepTask.server";
import { FileLoaderTask } from "./task/FileLoaderTask.server";
import { FileSedTask } from "./task/FileSedTask.server";

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileGrepTask);
  TaskRegistry.registerTask(FileLoaderTask);
  TaskRegistry.registerTask(FileSedTask);
  return [...tasks, FileGrepTask, FileLoaderTask, FileSedTask];
};
