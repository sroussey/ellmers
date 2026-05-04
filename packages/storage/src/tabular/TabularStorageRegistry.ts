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
import { AnyTabularStorage } from "./ITabularStorage";

/**
 * Service token for the tabular repository registry
 * Maps repository IDs to ITabularStorage instances
 */
export const TABULAR_REPOSITORIES = createServiceToken<Map<string, AnyTabularStorage>>(
  "storage.tabular.repositories"
);

/**
 * Gets the tabular repository registry from the given registry (defaults to global).
 */
export function getGlobalTabularRepositories(
  registry: ServiceRegistry = globalServiceRegistry
): Map<string, AnyTabularStorage> {
  return registry.get(TABULAR_REPOSITORIES);
}

/**
 * Registers a tabular repository globally by ID
 * @param id The unique identifier for this repository
 * @param repository The repository instance to register
 */
export function registerTabularRepository(id: string, repository: AnyTabularStorage): void {
  const repos = getGlobalTabularRepositories();
  repos.set(id, repository);
}

/**
 * Gets a tabular repository by ID from the global registry
 * @param id The repository identifier
 * @returns The repository instance or undefined if not found
 */
export function getTabularRepository(id: string): AnyTabularStorage | undefined {
  return getGlobalTabularRepositories().get(id);
}

/**
 * Resolves a repository ID to an instance from the registry.
 * Used by the input resolver system.
 */
function resolveRepositoryFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): AnyTabularStorage {
  const repos = registry.has(TABULAR_REPOSITORIES)
    ? registry.get(TABULAR_REPOSITORIES)
    : getGlobalTabularRepositories();
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
  const repos = registry.has(TABULAR_REPOSITORIES)
    ? registry.get(TABULAR_REPOSITORIES)
    : getGlobalTabularRepositories();

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

// Self-register on the global registry. Idempotent.
registerTabularStorageDefaults();
