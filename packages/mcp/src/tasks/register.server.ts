/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Side-effect import: registers MCP task dependencies for Node/Bun server runtimes.
 * Import this module (or @workglow/mcp/tasks from a node/bun entry) before using MCP tasks.
 */

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "@workglow/mcp/util";
import { mcpClientFactory, mcpServerConfigSchema, registerMcpTaskDeps } from "@workglow/mcp/util";

registerMcpTaskDeps({
  mcpClientFactory,
  mcpServerConfigSchema,
  createStdioTransport: (config: McpServerConfig) =>
    Promise.resolve(
      new StdioClientTransport({
        command: config.command!,
        args: config.args,
        env: config.env,
      })
    ),
});
