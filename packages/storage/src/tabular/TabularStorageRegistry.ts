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
import type { AnyTabularStorage } from "./ITabularStorage";

export const TABULAR_REPOSITORIES = createServiceToken<Map<string, AnyTabularStorage>>(
  "storage.tabular.repositories"
);

/**
 * Gets the tabular repository map from the given registry (defaults to global).
 * Lazy-registers an empty map if absent — keeps scoped registries isolated.
 */
export function getGlobalTabularRepositories(
  registry: ServiceRegistry = globalServiceRegistry
): Map<string, AnyTabularStorage> {
  if (!registry.has(TABULAR_REPOSITORIES)) {
    registerTabularStorageDefaults(registry);
  }
  return registry.get(TABULAR_REPOSITORIES);
}

export function registerTabularRepository(
  id: string,
  repository: AnyTabularStorage,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  const repos = getGlobalTabularRepositories(registry);
  repos.set(id, repository);
}

export function getTabularRepository(
  id: string,
  registry: ServiceRegistry = globalServiceRegistry
): AnyTabularStorage | undefined {
  return getGlobalTabularRepositories(registry).get(id);
}

/**
 * Resolves a repository ID to an instance from the registry.
 * Used by the input resolver system. Always reads from the supplied registry —
 * no fallback to global state, so scoped registries stay isolated.
 */
function resolveRepositoryFromRegistry(
  id: string,
  _format: string,
  registry: ServiceRegistry
): AnyTabularStorage {
  const repos = getGlobalTabularRepositories(registry);
  const repo = repos.get(id);
  if (!repo) {
    throw new Error(`Tabular storage "${id}" not found in registry`);
  }
  return repo;
}

function compactTabularRepository(
  value: unknown,
  _format: string,
  registry: ServiceRegistry
): string | undefined {
  const repos = getGlobalTabularRepositories(registry);
  for (const [id, repo] of repos) {
    if (repo === value) return id;
  }
  return undefined;
}

/**
 * Registers the tabular storage default factory and the "storage:tabular" input resolver/compactor
 * on the given registry. Called by `bootstrapWorkglow` and `createOrchestrationContext`.
 */
export function registerTabularStorageDefaults(
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerIfAbsent(
    TABULAR_REPOSITORIES,
    (): Map<string, AnyTabularStorage> => new Map(),
    true
  );
  registerInputResolver("storage:tabular", resolveRepositoryFromRegistry, registry);
  registerInputCompactor("storage:tabular", compactTabularRepository, registry);
}

// Self-register on the global registry; idempotent.
registerTabularStorageDefaults();
