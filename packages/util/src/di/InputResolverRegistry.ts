/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "./ServiceRegistry";
import { createServiceToken, globalServiceRegistry } from "./ServiceRegistry";

/**
 * A resolver function that converts a string ID to an instance.
 * Returns undefined if the resolver cannot handle this format.
 * Throws an error if the ID is not found.
 *
 * @param id The string ID to resolve
 * @param format The full format string (e.g., "model:TextEmbedding", "storage:tabular")
 * @param registry The service registry to use for lookups
 */
export type InputResolverFn = (
  id: string,
  format: string,
  registry: ServiceRegistry
) => unknown | Promise<unknown>;

/**
 * Service token for the input resolver registry.
 * Maps format prefixes to resolver functions.
 */
export const INPUT_RESOLVERS =
  createServiceToken<Map<string, InputResolverFn>>("task.input.resolvers");

/**
 * Registers an empty resolver map on the given registry if absent.
 * Called as part of `bootstrapWorkglow` / `createOrchestrationContext`.
 */
export function registerInputResolverDefaults(
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerIfAbsent(INPUT_RESOLVERS, (): Map<string, InputResolverFn> => new Map(), true);
}

// Self-register on the global registry. Idempotent.
registerInputResolverDefaults();

/**
 * Gets the input resolver registry from the given registry (defaults to global).
 */
export function getInputResolvers(
  registry: ServiceRegistry = globalServiceRegistry
): Map<string, InputResolverFn> {
  if (!registry.has(INPUT_RESOLVERS)) {
    registerInputResolverDefaults(registry);
  }
  return registry.get(INPUT_RESOLVERS);
}

/**
 * Registers an input resolver for a format prefix.
 * The resolver will be called for any format that starts with this prefix.
 *
 * @param formatPrefix The format prefix to match (e.g., "model", "dataset")
 * @param resolver The resolver function
 *
 * @example
 * ```typescript
 * // Register model resolver
 * registerInputResolver("model", async (id, format, registry) => {
 *   const modelRepo = registry.get(MODEL_REPOSITORY);
 *   const model = await modelRepo.findByName(id);
 *   if (!model) throw new Error(`Model "${id}" not found`);
 *   return model;
 * });
 *
 * // Register dataset resolver
 * registerInputResolver("dataset", (id, format, registry) => {
 *   const datasetType = format.split(":")[1]; // "tabular", "vector", etc.
 *   if (datasetType === "tabular") {
 *     const datasets = registry.get(TABULAR_DATASETS);
 *     const dataset = datasets.get(id);
 *     if (!dataset) throw new Error(`Dataset "${id}" not found`);
 *     return dataset;
 *   }
 *   throw new Error(`Unknown dataset type: ${datasetType}`);
 * });
 * ```
 */
export function registerInputResolver(
  formatPrefix: string,
  resolver: InputResolverFn,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  const resolvers = getInputResolvers(registry);
  resolvers.set(formatPrefix, resolver);
}
