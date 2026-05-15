/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerInputCompactor } from "../di/InputCompactorRegistry";
import { registerInputResolver } from "../di/InputResolverRegistry";
import type { ServiceRegistry } from "../di/ServiceRegistry";
import { globalServiceRegistry } from "../di/ServiceRegistry";
import type { ICredentialStore } from "./ICredentialStore";
import { CREDENTIAL_STORE } from "./ICredentialStore";
import { InMemoryCredentialStore } from "./InMemoryCredentialStore";

/**
 * Gets the credential store from the given registry (defaults to global).
 * If the registry hasn't had `registerCredentialDefaults(registry)` run yet,
 * the default in-memory store is registered lazily — same pattern as
 * `getLogger` / `getTelemetryProvider`. Makes scoped registries returned by
 * `createOrchestrationContext` safe to use without an explicit bootstrap.
 */
export function getGlobalCredentialStore(
  registry: ServiceRegistry = globalServiceRegistry
): ICredentialStore {
  if (!registry.has(CREDENTIAL_STORE)) {
    registerCredentialDefaults(registry);
  }
  return registry.get(CREDENTIAL_STORE);
}

/**
 * Sets the credential store on the given registry (defaults to global).
 */
export function setGlobalCredentialStore(
  store: ICredentialStore,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerInstance(CREDENTIAL_STORE, store);
}

/**
 * Resolves a credential from the store registered in the given registry.
 *
 * If `registry` is omitted, uses the global registry. If a `registry` is
 * passed but doesn't yet have `CREDENTIAL_STORE`, `getGlobalCredentialStore`
 * lazily registers the default in-memory store on it — so scoped registries
 * stay isolated from the global one.
 *
 * Intended for use in provider `getClient` functions and tasks.
 *
 * @param key The credential key to resolve
 * @param registry Optional service registry (e.g., from task context)
 * @returns The credential value, or undefined if not found
 */
export async function resolveCredential(
  key: string,
  registry?: ServiceRegistry
): Promise<string | undefined> {
  const store = getGlobalCredentialStore(registry);
  return store.get(key);
}

/**
 * Registers the credential store default factory and the "credential" input resolver/compactor
 * on the given registry. Called by `bootstrapWorkglow` and `createOrchestrationContext`.
 */
export function registerCredentialDefaults(
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerIfAbsent(
    CREDENTIAL_STORE,
    (): ICredentialStore => new InMemoryCredentialStore(),
    true
  );
  registerInputResolver(
    "credential",
    async (id, _format, registry) => {
      return (await resolveCredential(id, registry)) ?? id;
    },
    registry
  );
  registerInputCompactor(
    "credential",
    (value) => (typeof value === "string" ? value : undefined),
    registry
  );
}

// Self-register on the global registry. Idempotent.
registerCredentialDefaults();
