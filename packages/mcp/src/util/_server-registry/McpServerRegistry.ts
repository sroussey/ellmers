/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  globalServiceRegistry,
  registerInputCompactor,
  registerInputResolver,
  ServiceRegistry,
} from "@workglow/util";
import { InMemoryMcpServerRepository } from "./InMemoryMcpServerRepository";
import { McpServerRepository } from "./McpServerRepository";
import type { McpServerRecord } from "./McpServerSchema";

export interface McpServerConnection {
  readonly config: McpServerRecord;
}

export const MCP_SERVERS =
  createServiceToken<Map<string, McpServerConnection>>("mcp-server.registry");

export const MCP_SERVER_REPOSITORY =
  createServiceToken<McpServerRepository>("mcp-server.repository");

globalServiceRegistry.registerIfAbsent(
  MCP_SERVERS,
  (): Map<string, McpServerConnection> => new Map(),
  true
);

globalServiceRegistry.registerIfAbsent(
  MCP_SERVER_REPOSITORY,
  (): McpServerRepository => new InMemoryMcpServerRepository(),
  true
);

export function getGlobalMcpServers(): Map<string, McpServerConnection> {
  return globalServiceRegistry.get(MCP_SERVERS);
}

export function getGlobalMcpServerRepository(): McpServerRepository {
  return globalServiceRegistry.get(MCP_SERVER_REPOSITORY);
}

export function setGlobalMcpServerRepository(repository: McpServerRepository): void {
  globalServiceRegistry.registerInstance(MCP_SERVER_REPOSITORY, repository);
}

export async function registerMcpServer(config: McpServerRecord): Promise<void> {
  const servers = getGlobalMcpServers();
  servers.set(config.server_id, { config });

  const repo = getGlobalMcpServerRepository();
  await repo.addServer(config);
}

export function getMcpServer(id: string): McpServerConnection | undefined {
  return getGlobalMcpServers().get(id);
}

async function resolveServerFromRegistry(
  id: string,
  _format: string,
  registry: ServiceRegistry
): Promise<McpServerRecord> {
  // Check scoped registry first
  const servers = registry.has(MCP_SERVERS)
    ? registry.get<Map<string, McpServerConnection>>(MCP_SERVERS)
    : getGlobalMcpServers();

  const entry = servers.get(id);
  if (entry) return entry.config;

  // Fall back to repository lookup
  const repo = registry.has(MCP_SERVER_REPOSITORY)
    ? registry.get<McpServerRepository>(MCP_SERVER_REPOSITORY)
    : getGlobalMcpServerRepository();

  const record = await repo.getServer(id);
  if (!record) {
    throw new Error(`MCP server "${id}" not found in registry`);
  }
  return record;
}

registerInputResolver("mcp-server", resolveServerFromRegistry);

// Register the compactor — extracts server_id from an McpServerRecord
registerInputCompactor("mcp-server", (value) => {
  if (typeof value === "object" && value !== null && "server_id" in value) {
    const id = (value as Record<string, unknown>).server_id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
});
