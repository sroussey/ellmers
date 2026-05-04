/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "../di/ServiceRegistry";
import type { ServiceRegistry } from "../di/ServiceRegistry";
import { registerInputCompactor } from "../di/InputCompactorRegistry";
import { registerInputResolver } from "../di/InputResolverRegistry";
import { CREDENTIAL_STORE } from "./ICredentialStore";
import type { ICredentialStore } from "./ICredentialStore";
import { InMemoryCredentialStore } from "./InMemoryCredentialStore";

/**
 * Gets the credential store from the given registry (defaults to global).
 */
export function getGlobalCredentialStore(
  registry: ServiceRegistry = globalServiceRegistry
): ICredentialStore {
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
 * Resolves a credential from the store registered in the given registry,
 * falling back to the global credential store.
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
  const store =
    registry && registry.has(CREDENTIAL_STORE)
      ? registry.get<ICredentialStore>(CREDENTIAL_STORE)
      : getGlobalCredentialStore();

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
