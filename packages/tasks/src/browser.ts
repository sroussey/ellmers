/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "./codec.browser";
import "./task/image/registerImageTextRenderer.browser";

export * from "./common";
export * from "./task/FileLoaderTask";
import { mcpClientFactory, mcpServerConfigSchema, registerMcpTaskDeps } from "@workglow/mcp/util";

registerMcpTaskDeps({
  mcpClientFactory,
  mcpServerConfigSchema,
  createStdioTransport: () => {
    throw new Error(
      "stdio transport is not available in the browser. Use streamable-http or sse instead."
    );
  },
});

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileLoaderTask } from "./task/FileLoaderTask";

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileLoaderTask);
  return [...tasks, FileLoaderTask];
};
