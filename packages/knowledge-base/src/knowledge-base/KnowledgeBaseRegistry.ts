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
import { InMemoryKnowledgeBaseRepository } from "./InMemoryKnowledgeBaseRepository";
import type { KnowledgeBase } from "./KnowledgeBase";
import { KnowledgeBaseRepository } from "./KnowledgeBaseRepository";
import type { KnowledgeBaseRecord } from "./KnowledgeBaseSchema";
import { knowledgeBaseTableNames } from "./KnowledgeBaseSchema";
import { SHARED_CHUNK_TABLE, SHARED_DOCUMENT_TABLE } from "./SharedTableSchemas";

/**
 * Service token for the knowledge base registry
 * Maps knowledge base IDs to KnowledgeBase instances
 */
export const KNOWLEDGE_BASES =
  createServiceToken<Map<string, KnowledgeBase>>("knowledge-base.registry");

/**
 * Service token for the knowledge base repository
 */
export const KNOWLEDGE_BASE_REPOSITORY = createServiceToken<KnowledgeBaseRepository>(
  "knowledge-base.repository"
);

/**
 * Gets the knowledge base map from the given registry (defaults to global).
 */
export function getGlobalKnowledgeBases(
  registry: ServiceRegistry = globalServiceRegistry
): Map<string, KnowledgeBase> {
  return registry.get(KNOWLEDGE_BASES);
}

/**
 * Gets the knowledge base repository instance from the given registry (defaults to global).
 */
export function getGlobalKnowledgeBaseRepository(
  registry: ServiceRegistry = globalServiceRegistry
): KnowledgeBaseRepository {
  return registry.get(KNOWLEDGE_BASE_REPOSITORY);
}

/**
 * Sets the knowledge base repository instance on the given registry (defaults to global).
 */
export function setGlobalKnowledgeBaseRepository(
  repository: KnowledgeBaseRepository,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerInstance(KNOWLEDGE_BASE_REPOSITORY, repository);
}

export interface RegisterKnowledgeBaseOptions {
  /** When true, record uses shared table names instead of per-KB table names. */
  readonly sharedTables?: boolean;
}

/**
 * Per-ID promise chain that serializes register/unregister operations
 * on the same knowledge base ID, preventing Map/repo divergence
 * during async interleaving.
 */
const pendingOps = new Map<string, Promise<void>>();

/**
 * Enqueues an async operation for the given ID so that concurrent
 * calls on the same ID execute sequentially.
 */
function withIdLock(id: string, fn: () => Promise<void>): Promise<void> {
  const prev = pendingOps.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  pendingOps.set(id, next);
  const cleanup = () => {
    if (pendingOps.get(id) === next) {
      pendingOps.delete(id);
    }
  };
  next.finally(cleanup);
  return next;
}

/**
 * Registers a knowledge base globally by ID.
 * Adds to both the live Map and the persistent repository.
 * Serialized per-ID to prevent Map/repo divergence on concurrent calls.
 */

export function registerKnowledgeBase(
  id: string,
  kb: KnowledgeBase,
  options?: RegisterKnowledgeBaseOptions
): Promise<void> {
  return withIdLock(id, async () => {
    const kbs = getGlobalKnowledgeBases();

    const now = new Date().toISOString();
    const useShared = options?.sharedTables === true;
    const tableNames = useShared
      ? { documentTable: SHARED_DOCUMENT_TABLE, chunkTable: SHARED_CHUNK_TABLE }
      : knowledgeBaseTableNames(id);
    const record: KnowledgeBaseRecord = {
      kb_id: id,
      title: kb.title,
      description: kb.description,
      vector_dimensions: kb.getVectorDimensions(),
      document_table: tableNames.documentTable,
      chunk_table: tableNames.chunkTable,
      created_at: now,
      updated_at: now,
    };

    // Write to persistent repository first so a failure doesn't leave stale in-memory state
    const repo = getGlobalKnowledgeBaseRepository();
    await repo.addKnowledgeBase(record);

    // Only add to live map after successful persistence
    kbs.set(id, kb);
  });
}

/**
 * Unregisters a knowledge base by ID.
 * Removes from both the persistent repository and the live Map.
 * Serialized per-ID to prevent Map/repo divergence on concurrent calls.
 */
export function unregisterKnowledgeBase(id: string): Promise<void> {
  return withIdLock(id, async () => {
    const repo = getGlobalKnowledgeBaseRepository();
    await repo.removeKnowledgeBase(id);

    const kbs = getGlobalKnowledgeBases();
    kbs.delete(id);
  });
}

/**
 * Deregisters a knowledge base by ID.
 * Removes from both the live Map and the persistent repository.
 */
export async function deregisterKnowledgeBase(id: string): Promise<void> {
  // Remove from persistent repository first so a failure doesn't leave stale in-memory state
  const repo = getGlobalKnowledgeBaseRepository();
  await repo.removeKnowledgeBase(id);

  const kbs = getGlobalKnowledgeBases();
  kbs.delete(id);
}

/**
 * Gets a knowledge base by ID from the global registry
 */
export function getKnowledgeBase(id: string): KnowledgeBase | undefined {
  return getGlobalKnowledgeBases().get(id);
}

/**
 * Resolves a knowledge base ID from the registry.
 * Used by the input resolver system.
 */
async function resolveKnowledgeBaseFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<KnowledgeBase> {
  const kbs = registry.has(KNOWLEDGE_BASES)
    ? registry.get<Map<string, KnowledgeBase>>(KNOWLEDGE_BASES)
    : getGlobalKnowledgeBases();

  const kb = kbs.get(id);
  if (!kb) {
    throw new Error(`Knowledge base "${id}" not found in registry`);
  }
  return kb;
}

function compactKnowledgeBase(
  value: unknown,
  _format: string,
  registry: ServiceRegistry
): string | undefined {
  const kbs = registry.has(KNOWLEDGE_BASES)
    ? registry.get<Map<string, KnowledgeBase>>(KNOWLEDGE_BASES)
    : getGlobalKnowledgeBases();

  for (const [id, kb] of kbs) {
    if (kb === value) return id;
  }
  return undefined;
}

/**
 * Registers the knowledge base default factories and the "knowledge-base" input resolver/compactor
 * on the given registry. Called by `bootstrapWorkglow` and `createOrchestrationContext`.
 */
export function registerKnowledgeBaseDefaults(
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerIfAbsent(KNOWLEDGE_BASES, (): Map<string, KnowledgeBase> => new Map(), true);
  registry.registerIfAbsent(
    KNOWLEDGE_BASE_REPOSITORY,
    (): KnowledgeBaseRepository => new InMemoryKnowledgeBaseRepository(),
    true
  );
  registerInputResolver("knowledge-base", resolveKnowledgeBaseFromRegistry, registry);
  registerInputCompactor("knowledge-base", compactKnowledgeBase, registry);
}

// Self-register on the global registry. Idempotent — a no-op once
// `bootstrapWorkglow()` (or another importer) has populated these tokens.
registerKnowledgeBaseDefaults();
