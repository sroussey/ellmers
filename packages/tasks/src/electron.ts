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
export * from "./task/FileLoaderTask.server";

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileGrepTask } from "./task/FileGrepTask.server";
import { FileLoaderTask } from "./task/FileLoaderTask.server";

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileGrepTask);
  TaskRegistry.registerTask(FileLoaderTask);
  return [...tasks, FileGrepTask, FileLoaderTask];
};
