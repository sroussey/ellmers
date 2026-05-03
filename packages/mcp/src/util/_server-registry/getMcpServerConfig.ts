/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpServerConfig } from "../McpTaskDeps";

/**
 * Extracts a McpServerConfig from a task's config or input object.
 *
 * Expects `configOrInput.server` to be an object with all connection fields.
 * If `server` is a string (unresolved reference ID), an error is thrown.
 */
export function getMcpServerConfig(
  configOrInput: Readonly<Record<string, unknown>>
): McpServerConfig {
  const server = configOrInput.server;

  if (!server) {
    throw new Error("MCP server config must include a 'server' property");
  }

  if (typeof server === "string") {
    throw new Error(
      "MCP server config 'server' is a string reference ID that should have been resolved to an object before execution"
    );
  }

  if (typeof server !== "object" || Array.isArray(server)) {
    throw new Error("MCP server config 'server' must be an object");
  }

  const base = server as Record<string, unknown>;
  const transport = base.transport as string | undefined;

  if (!transport) {
    throw new Error("MCP server config must include a transport");
  }

  if (transport === "stdio" && !base.command) {
    throw new Error("MCP server config for stdio transport must include a 'command'");
  }

  if ((transport === "sse" || transport === "streamable-http") && !base.server_url) {
    throw new Error(
      "MCP server config for sse/streamable-http transport must include a 'server_url'"
    );
  }

  return base as unknown as McpServerConfig;
}
