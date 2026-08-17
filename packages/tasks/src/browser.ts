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

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileGrepTask } from "./task/FileGrepTask";
import { FileLoaderTask } from "./task/FileLoaderTask";
import { FileSedTask } from "./task/FileSedTask";

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileGrepTask);
  TaskRegistry.registerTask(FileLoaderTask);
  TaskRegistry.registerTask(FileSedTask);
  return [...tasks, FileGrepTask, FileLoaderTask, FileSedTask];
};
