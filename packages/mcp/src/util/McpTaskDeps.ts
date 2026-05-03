/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform MCP client + JSON Schema for MCP tasks. Registered from browser/node/bun
 * entry files so task implementations do not import `@workglow/tasks` (self-import).
 */

import type { Client } from "@modelcontextprotocol/sdk/client";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { createServiceToken, globalServiceRegistry } from "@workglow/util";
import type { McpAuthConfig } from "./McpAuthTypes";

/** Configuration for connecting to an MCP server (superset of all platform transports). */
export interface McpServerConfig {
  readonly transport?: string;
  readonly server_url?: string;
  // stdio-only (node/bun)
  readonly command?: string;
  readonly args?: string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly auth?: McpAuthConfig;
  // Flat auth properties from schema (used when config comes from JSON Schema forms)
  readonly auth_type?: string;
  // External auth provider — when set, bypasses internal auth resolution for OAuth flows
  readonly authProvider?: OAuthClientProvider;
}

export interface McpTaskDeps {
  readonly mcpClientFactory: {
    readonly create: (
      config: McpServerConfig,
      signal?: AbortSignal
    ) => Promise<{ client: Client; transport: Transport }>;
  };
  readonly mcpServerConfigSchema: {
    readonly properties: DataPortSchemaObject["properties"];
    readonly allOf: NonNullable<DataPortSchemaObject["allOf"]>;
  };
  readonly createStdioTransport: (config: McpServerConfig) => Promise<Transport>;
}

export const MCP_TASK_DEPS = createServiceToken<McpTaskDeps>("@workglow/tasks/mcp");

export function registerMcpTaskDeps(deps: McpTaskDeps): void {
  globalServiceRegistry.registerInstance(MCP_TASK_DEPS, deps);
}

export function getMcpTaskDeps(): McpTaskDeps {
  if (!globalServiceRegistry.has(MCP_TASK_DEPS)) {
    throw new Error(
      "MCP task dependencies not registered. Import @workglow/tasks from a platform entry (browser, node, or bun) before using MCP tasks."
    );
  }
  return globalServiceRegistry.get(MCP_TASK_DEPS);
}
