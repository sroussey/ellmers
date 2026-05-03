/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified MCP client util. Full schema is available on all platforms.
 * stdio transport is injected via McpTaskDeps and only available on Node/Bun.
 */

import { Client } from "@modelcontextprotocol/sdk/client";
// eslint-disable-next-line deprecation/deprecation
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getGlobalCredentialStore, getLogger } from "@workglow/util";
import { createAuthProvider, resolveAuthSecrets } from "./McpAuthProvider";
import { buildAuthConfig, mcpAuthConfigSchema } from "./McpAuthTypes";
import type { McpAuthConfig } from "./McpAuthTypes";
import { getMcpTaskDeps } from "./McpTaskDeps";
import type { McpServerConfig } from "./McpTaskDeps";

export const mcpTransportTypes = ["stdio", "sse", "streamable-http"] as const;

export const mcpServerConfigSchema = {
  properties: {
    transport: {
      type: "string",
      enum: mcpTransportTypes,
      title: "Transport",
      description: "The transport type to use for connecting to the MCP server",
    },
    server_url: {
      type: "string",
      format: "uri",
      title: "Server URL",
      description: "The URL of the MCP server (for sse and streamable-http transports)",
    },
    command: {
      type: "string",
      title: "Command",
      description: "The command to run (for stdio transport)",
    },
    args: {
      type: "array",
      items: { type: "string" },
      title: "Arguments",
      description: "Command arguments (for stdio transport)",
    },
    env: {
      type: "object",
      additionalProperties: { type: "string" },
      title: "Environment",
      description: "Environment variables (for stdio transport)",
    },
    ...mcpAuthConfigSchema.properties,
  },
  allOf: [
    {
      if: { properties: { transport: { const: "stdio" as const } }, required: ["transport"] },
      then: { required: ["command"] },
    },
    {
      if: { properties: { transport: { const: "sse" as const } }, required: ["transport"] },
      then: { required: ["server_url"] },
    },
    {
      if: {
        properties: { transport: { const: "streamable-http" as const } },
        required: ["transport"],
      },
      then: { required: ["server_url"] },
    },
    ...mcpAuthConfigSchema.allOf,
  ] as readonly Record<string, unknown>[],
} as const;

export type McpTransportType = (typeof mcpTransportTypes)[number];

export async function createMcpClient(
  config: McpServerConfig,
  signal?: AbortSignal
): Promise<{ client: Client; transport: Transport }> {
  let transport: Transport;

  // Resolve auth config: prefer structured `auth` object, fall back to flat props
  let auth: McpAuthConfig | undefined = config.auth ?? buildAuthConfig({ ...config });

  // Resolve credential store keys to actual secret values
  if (auth && auth.type !== "none") {
    auth = await resolveAuthSecrets(auth, getGlobalCredentialStore());
  }

  // Build auth provider for OAuth flows (external provider takes precedence)
  const authProvider =
    config.authProvider ??
    (auth && auth.type !== "none" && auth.type !== "bearer"
      ? createAuthProvider(auth, config.server_url ?? "", getGlobalCredentialStore())
      : undefined);

  // Build request headers (SDK sets MCP-Protocol-Version automatically)
  const headers: Record<string, string> = {
    ...(auth?.type === "bearer" ? { Authorization: `Bearer ${auth.token}` } : {}),
  };
  const requestInit = { headers };

  switch (config.transport) {
    case "stdio":
      if (auth && auth.type !== "none") {
        getLogger().warn(
          "MCP auth is not supported for stdio transport; auth config ignored. " +
            "Use env vars to pass credentials to stdio servers."
        );
      }
      transport = await getMcpTaskDeps().createStdioTransport(config);
      break;
    case "sse": {
      transport = new SSEClientTransport(new URL(config.server_url!), {
        authProvider,
        requestInit,
      });
      break;
    }
    case "streamable-http": {
      transport = new StreamableHTTPClientTransport(new URL(config.server_url!), {
        authProvider,
        requestInit,
      });
      break;
    }
    default:
      throw new Error(`Unsupported transport type: ${config.transport}`);
  }

  const client = new Client({ name: "workglow-mcp-client", version: "1.0.0" });

  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        client.close().catch(() => {});
      },
      { once: true }
    );
  }

  await client.connect(transport);
  return { client, transport };
}

export const mcpClientFactory = {
  create: createMcpClient,
};
