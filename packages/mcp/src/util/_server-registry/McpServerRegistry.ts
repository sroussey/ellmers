/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "@workglow/util";
import {
  createServiceToken,
  globalServiceRegistry,
  registerInputCompactor,
  registerInputResolver,
} from "@workglow/util";
import { InMemoryMcpServerRepository } from "./InMemoryMcpServerRepository";
import type { McpServerRepository } from "./McpServerRepository";
import type { McpServerRecord } from "./McpServerSchema";

export interface McpServerConnection {
  readonly config: McpServerRecord;
}

export const MCP_SERVERS =
  createServiceToken<Map<string, McpServerConnection>>("mcp-server.registry");

export const MCP_SERVER_REPOSITORY =
  createServiceToken<McpServerRepository>("mcp-server.repository");

/**
 * Gets the MCP server map from the given registry (defaults to global).
 * Lazy-registers defaults if absent.
 */
export function getGlobalMcpServers(
  registry: ServiceRegistry = globalServiceRegistry
): Map<string, McpServerConnection> {
  if (!registry.has(MCP_SERVERS)) {
    registerMcpServerDefaults(registry);
  }
  return registry.get(MCP_SERVERS);
}

/**
 * Gets the MCP server repository from the given registry (defaults to global).
 * Lazy-registers defaults if absent.
 */
export function getGlobalMcpServerRepository(
  registry: ServiceRegistry = globalServiceRegistry
): McpServerRepository {
  if (!registry.has(MCP_SERVER_REPOSITORY)) {
    registerMcpServerDefaults(registry);
  }
  return registry.get(MCP_SERVER_REPOSITORY);
}

export function setGlobalMcpServerRepository(
  repository: McpServerRepository,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerInstance(MCP_SERVER_REPOSITORY, repository);
}

/**
 * Registers an MCP server on the given registry (defaults to global).
 * Adds to both the live map and the persistent repository.
 */
export async function registerMcpServer(
  config: McpServerRecord,
  registry: ServiceRegistry = globalServiceRegistry
): Promise<void> {
  const servers = getGlobalMcpServers(registry);
  servers.set(config.server_id, { config });

  const repo = getGlobalMcpServerRepository(registry);
  await repo.addServer(config);
}

export function getMcpServer(
  id: string,
  registry: ServiceRegistry = globalServiceRegistry
): McpServerConnection | undefined {
  return getGlobalMcpServers(registry).get(id);
}

async function resolveServerFromRegistry(
  id: string,
  _format: string,
  registry: ServiceRegistry
): Promise<McpServerRecord> {
  const servers = getGlobalMcpServers(registry);
  const entry = servers.get(id);
  if (entry) return entry.config;

  const repo = getGlobalMcpServerRepository(registry);
  const record = await repo.getServer(id);
  if (!record) {
    throw new Error(`MCP server "${id}" not found in registry`);
  }
  return record;
}

function compactMcpServer(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "server_id" in value) {
    const id = (value as Record<string, unknown>).server_id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * Registers the MCP server default factories and the "mcp-server" input
 * resolver/compactor on the given registry.
 */
export function registerMcpServerDefaults(registry: ServiceRegistry = globalServiceRegistry): void {
  registry.registerIfAbsent(MCP_SERVERS, (): Map<string, McpServerConnection> => new Map(), true);
  registry.registerIfAbsent(
    MCP_SERVER_REPOSITORY,
    (): McpServerRepository => new InMemoryMcpServerRepository(),
    true
  );
  registerInputResolver("mcp-server", resolveServerFromRegistry, registry);
  registerInputCompactor("mcp-server", compactMcpServer, registry);
}

// Self-register on the global registry. Idempotent.
registerMcpServerDefaults();
