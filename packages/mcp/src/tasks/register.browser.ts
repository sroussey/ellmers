/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Side-effect import: registers MCP task dependencies for the browser runtime.
 * Import this module (or @workglow/mcp/tasks from a browser entry) before using MCP tasks.
 */

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
