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
import { InMemoryKnowledgeBaseRepository } from "./InMemoryKnowledgeBaseRepository";
import type { KnowledgeBase } from "./KnowledgeBase";
import type { KnowledgeBaseRepository } from "./KnowledgeBaseRepository";
import type { KnowledgeBaseRecord } from "./KnowledgeBaseSchema";
import { knowledgeBaseTableNames } from "./KnowledgeBaseSchema";
import { SHARED_CHUNK_TABLE, SHARED_DOCUMENT_TABLE } from "./SharedTableSchemas";

export const KNOWLEDGE_BASES =
  createServiceToken<Map<string, KnowledgeBase>>("knowledge-base.registry");

export const KNOWLEDGE_BASE_REPOSITORY = createServiceToken<KnowledgeBaseRepository>(
  "knowledge-base.repository"
);

/**
 * Gets the knowledge base map from the given registry (defaults to global).
 * Lazily registers defaults if the token isn't present on the registry —
 * makes scoped registries safe without an explicit
 * `registerKnowledgeBaseDefaults(registry)`.
 */
export function getGlobalKnowledgeBases(
  registry: ServiceRegistry = globalServiceRegistry
): Map<string, KnowledgeBase> {
  if (!registry.has(KNOWLEDGE_BASES)) {
    registerKnowledgeBaseDefaults(registry);
  }
  return registry.get(KNOWLEDGE_BASES);
}

export function getGlobalKnowledgeBaseRepository(
  registry: ServiceRegistry = globalServiceRegistry
): KnowledgeBaseRepository {
  if (!registry.has(KNOWLEDGE_BASE_REPOSITORY)) {
    registerKnowledgeBaseDefaults(registry);
  }
  return registry.get(KNOWLEDGE_BASE_REPOSITORY);
}

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
 * Per-ID promise chain that serializes register/unregister operations on the
 * same knowledge base ID to prevent Map/repo divergence under async interleaving.
 */
const pendingOps = new Map<string, Promise<void>>();

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
 * Adds to both the live Map and the persistent repository. Serialized per-ID
 * to prevent Map/repo divergence on concurrent calls.
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

    // Write to persistent repository first so a failure doesn't leave stale
    // in-memory state behind.
    const repo = getGlobalKnowledgeBaseRepository();
    await repo.addKnowledgeBase(record);

    kbs.set(id, kb);
  });
}

/** Serialized per-ID to prevent Map/repo divergence on concurrent calls. */
export function unregisterKnowledgeBase(id: string): Promise<void> {
  return withIdLock(id, async () => {
    const repo = getGlobalKnowledgeBaseRepository();
    await repo.removeKnowledgeBase(id);

    const kbs = getGlobalKnowledgeBases();
    kbs.delete(id);
  });
}

export function getKnowledgeBase(id: string): KnowledgeBase | undefined {
  return getGlobalKnowledgeBases().get(id);
}

async function resolveKnowledgeBaseFromRegistry(
  id: string,
  _format: string,
  registry: ServiceRegistry
): Promise<KnowledgeBase> {
  // Always read from the supplied registry. `getGlobalKnowledgeBases` lazy-
  // registers an empty map on it if absent, keeping scoped registries
  // isolated from the global KB list.
  const kbs = getGlobalKnowledgeBases(registry);
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
  const kbs = getGlobalKnowledgeBases(registry);
  for (const [id, kb] of kbs) {
    if (kb === value) return id;
  }
  return undefined;
}

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

// Self-register on the global registry; idempotent.
registerKnowledgeBaseDefaults();
