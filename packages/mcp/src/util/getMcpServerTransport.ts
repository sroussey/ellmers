/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Task } from "@workglow/task-graph";

/**
 * Resolve the MCP server transport from a task instance, preferring runtime
 * input (`runInputData.server.transport`) over construction-time config
 * (`config.server.transport`).
 */
export function getMcpServerTransport(task: Task<any, any, any>): string | undefined {
  const runInputData = (task as { runInputData?: Record<string, unknown> }).runInputData;
  const inputServer = runInputData?.server as Record<string, unknown> | undefined;
  if (typeof inputServer?.transport === "string") {
    return inputServer.transport;
  }

  const configServer = (task.config as Record<string, unknown>)?.server as
    | Record<string, unknown>
    | undefined;

  if (typeof configServer?.transport === "string") {
    return configServer.transport;
  }

  return undefined;
}
