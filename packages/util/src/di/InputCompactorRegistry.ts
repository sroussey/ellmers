/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "./ServiceRegistry";
import { createServiceToken, globalServiceRegistry } from "./ServiceRegistry";

/**
 * A compactor function that converts a resolved instance back to its string ID.
 * Returns undefined if the value cannot be compacted (e.g., missing ID field).
 *
 * @param value The resolved instance to compact
 * @param format The full format string (e.g., "model:TextEmbedding", "storage:tabular")
 * @param registry The service registry to use for lookups
 */
export type InputCompactorFn = (
  value: unknown,
  format: string,
  registry: ServiceRegistry
) => string | undefined | Promise<string | undefined>;

/**
 * Service token for the input compactor registry.
 * Maps format prefixes to compactor functions.
 */
export const INPUT_COMPACTORS =
  createServiceToken<Map<string, InputCompactorFn>>("task.input.compactors");

/**
 * Registers an empty compactor map on the given registry if absent.
 * Called as part of `bootstrapWorkglow` / `createOrchestrationContext`.
 */
export function registerInputCompactorDefaults(
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerIfAbsent(INPUT_COMPACTORS, (): Map<string, InputCompactorFn> => new Map(), true);
}

// Self-register on the global registry. Idempotent.
registerInputCompactorDefaults();

/**
 * Gets the input compactor registry from the given registry (defaults to global).
 */
export function getInputCompactors(
  registry: ServiceRegistry = globalServiceRegistry
): Map<string, InputCompactorFn> {
  if (!registry.has(INPUT_COMPACTORS)) {
    registerInputCompactorDefaults(registry);
  }
  return registry.get(INPUT_COMPACTORS);
}

/**
 * Registers an input compactor for a format prefix.
 * The compactor will be called to convert resolved instances back to string IDs.
 *
 * @param formatPrefix The format prefix to match (e.g., "model", "knowledge-base")
 * @param compactor The compactor function
 *
 * @example
 * ```typescript
 * // Register model compactor — extracts model_id from a ModelConfig
 * registerInputCompactor("model", (value) => {
 *   if (typeof value === "object" && value !== null && "model_id" in value) {
 *     const id = (value as Record<string, unknown>).model_id;
 *     return typeof id === "string" ? id : undefined;
 *   }
 *   return undefined;
 * });
 * ```
 */
export function registerInputCompactor(
  formatPrefix: string,
  compactor: InputCompactorFn,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  const compactors = getInputCompactors(registry);
  compactors.set(formatPrefix, compactor);
}
