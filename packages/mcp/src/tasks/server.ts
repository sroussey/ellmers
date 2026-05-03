/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpClientFactory, mcpServerConfigSchema } from "@workglow/mcp/util";
import type { McpServerConfig } from "@workglow/mcp/util";
import { registerMcpTaskDeps } from "@workglow/mcp/util";

export function registerMcpTaskDepsServer(): void {
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
}
