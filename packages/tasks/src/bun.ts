/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "./codec.node";
import "./task/image/registerImageTextRenderer.node";
// Install the DNS-resolving, connection-pinning SafeFetch implementation.
// This side-effect import must happen before FetchUrlTask is used.
import "./util/SafeFetch.server";

export * from "./common";
export * from "./task/FileLoaderTask.server";

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileLoaderTask } from "./task/FileLoaderTask.server";

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileLoaderTask);
  return [...tasks, FileLoaderTask];
};
