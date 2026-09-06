/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import { unhonorableOptions } from "./capabilityCheck";
import type { IWebSearchProvider, WebSearchRequest } from "./IWebSearchProvider";

/**
 * What to do about an empty registry. Importing the package registers the task
 * class but no provider, so the missing step is always a call rather than an
 * import.
 */
const NOTHING_REGISTERED_HINT =
  "Call registerBuiltInWebSearchProviders() for Brave/Tavily/SearXNG, or " +
  "registerWebSearchProvider() with your own.";

class Registry {
  private readonly providers = new Map<string, IWebSearchProvider>();

  register(provider: IWebSearchProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): IWebSearchProvider | undefined {
    return this.providers.get(name);
  }

  list(): IWebSearchProvider[] {
    return [...this.providers.values()];
  }

  clear(): void {
    this.providers.clear();
  }

  /** Pins a provider by name, or throws naming what is registered. */
  require(name: string): IWebSearchProvider {
    const found = this.providers.get(name);
    if (found) return found;
    const known = this.list().map((p) => p.name);
    throw new TaskConfigurationError(
      known.length === 0
        ? `WebSearchTask: provider ${JSON.stringify(name)} is not registered, and neither is any ` +
            `other. ${NOTHING_REGISTERED_HINT}`
        : `WebSearchTask: unknown provider ${JSON.stringify(name)}. Registered: ${known.join(", ")}.`
    );
  }

  /**
   * Refuses a credential key named for a provider that cannot receive one.
   *
   * Two names are refused: one matching nothing registered, which would
   * otherwise change nothing and be reported nowhere while the request goes out
   * unauthenticated; and one matching an adapter that authenticates through its
   * own vendor client, which moves that provider to the front of routing for a
   * key it then ignores.
   */
  assertCredentialKeyUsable(name: string): void {
    const provider = this.providers.get(name);
    if (provider === undefined) {
      const known = this.list().map((p) => p.name);
      throw new TaskConfigurationError(
        `WebSearchTask: credential_keys names ${JSON.stringify(name)}, which is not a ` +
          (known.length === 0
            ? `registered provider — none is registered. ${NOTHING_REGISTERED_HINT}`
            : `registered provider. Registered: ${known.join(", ")}.`)
      );
    }
    if (!provider.acceptsCredentialKey) {
      throw new TaskConfigurationError(
        `WebSearchTask: provider ${JSON.stringify(name)} never receives a credential-store ` +
          "key — it authenticates through its own client, or not at all. Configure its key " +
          "where the provider is registered, or in the vendor's own environment variable, and " +
          "drop it from credential_keys."
      );
    }
  }

  /**
   * Picks a registered provider that can serve every option the request states,
   * in registration order.
   *
   * A provider named in `credentialed` is considered first. Naming a credential
   * key for a provider states which vendors the caller actually holds a key for,
   * and only a key named for the provider that runs is ever sent — so without
   * this, routing lands on a provider with no key and the request goes out
   * unauthenticated while a usable one sits behind it.
   *
   * The failure message names which option ruled out which provider: with
   * several registered, "nothing satisfies this request" leaves an operator with
   * no way to tell whether to add a key, register another provider, or drop an
   * option.
   */
  route(
    request: WebSearchRequest,
    credentialed: ReadonlySet<string> = new Set()
  ): IWebSearchProvider {
    const candidates = this.list();
    if (candidates.length === 0) {
      throw new TaskConfigurationError(
        `WebSearchTask: No web-search providers are registered. ${NOTHING_REGISTERED_HINT}`
      );
    }
    const ordered =
      credentialed.size === 0
        ? candidates
        : [
            ...candidates.filter((c) => credentialed.has(c.name)),
            ...candidates.filter((c) => !credentialed.has(c.name)),
          ];
    const rejected: string[] = [];
    for (const candidate of ordered) {
      const gaps = unhonorableOptions(candidate.capabilities, request);
      if (gaps.length === 0) return candidate;
      rejected.push(`${candidate.name} (cannot serve: ${gaps.join(", ")})`);
    }
    throw new TaskConfigurationError(
      `WebSearchTask: no registered provider can serve this request. ${rejected.join("; ")}.`
    );
  }
}

/**
 * Process-wide provider registry, mirroring how the task registry and browser
 * session registry are reached in this repo.
 */
export const WebSearchProviderRegistry = new Registry();

export function registerWebSearchProvider(provider: IWebSearchProvider): void {
  WebSearchProviderRegistry.register(provider);
}
