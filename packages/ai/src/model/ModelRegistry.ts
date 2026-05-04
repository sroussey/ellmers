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
import { InMemoryModelRepository } from "./InMemoryModelRepository";
import { ModelRepository } from "./ModelRepository";
import type { ModelConfig } from "./ModelSchema";

/**
 * Service token for the global model repository
 */
export const MODEL_REPOSITORY = createServiceToken<ModelRepository>("model.repository");

/**
 * Gets the model repository from the given registry, falling back to the global registry.
 */
export function getGlobalModelRepository(registry: ServiceRegistry = globalServiceRegistry): ModelRepository {
  return registry.get(MODEL_REPOSITORY);
}

/**
 * Sets the model repository instance on the given registry (defaults to global).
 */
export function setGlobalModelRepository(
  repository: ModelRepository,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerInstance(MODEL_REPOSITORY, repository);
}

/**
 * Resolves a model ID to a ModelConfig from the repository.
 * Used by the input resolver system.
 */
async function resolveModelFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<ModelConfig | undefined> {
  const modelRepo = registry.has(MODEL_REPOSITORY)
    ? registry.get<ModelRepository>(MODEL_REPOSITORY)
    : getGlobalModelRepository();

  const model = await modelRepo.findByName(id);
  if (!model) {
    throw new Error(`Model "${id}" not found in repository`);
  }
  return model;
}

async function compactModel(
  value: unknown,
  _format: string,
  registry: ServiceRegistry
): Promise<string | undefined> {
  if (typeof value === "object" && value !== null && "model_id" in value) {
    const id = (value as Record<string, unknown>).model_id;
    if (typeof id !== "string") return undefined;
    const modelRepo = registry.has(MODEL_REPOSITORY)
      ? registry.get<ModelRepository>(MODEL_REPOSITORY)
      : getGlobalModelRepository();

    const model = await modelRepo.findByName(id);
    if (!model) return undefined;
    return id;
  }
  return undefined;
}

/**
 * Registers the model repository default factory and the "model" input resolver/compactor
 * on the given registry. Called by `bootstrapWorkglow` and `createOrchestrationContext`.
 */
export function registerModelDefaults(registry: ServiceRegistry = globalServiceRegistry): void {
  registry.registerIfAbsent(
    MODEL_REPOSITORY,
    (): ModelRepository => new InMemoryModelRepository(),
    true
  );
  registerInputResolver("model", resolveModelFromRegistry, registry);
  registerInputCompactor("model", compactModel, registry);
}

// Self-register on the global registry so module-relative imports (notably in
// tests, which load source files alongside built copies of dependencies) see
// the same defaults as `bootstrapWorkglow()`. Idempotent.
registerModelDefaults();
