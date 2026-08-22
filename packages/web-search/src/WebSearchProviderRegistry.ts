/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import { unhonorableOptions } from "./capabilityCheck";
import type { IWebSearchProvider, WebSearchRequest } from "./IWebSearchProvider";

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
            "other. Import @workglow/web-search from a server runtime to register the built-in providers."
        : `WebSearchTask: unknown provider ${JSON.stringify(name)}. Registered: ${known.join(", ")}.`
    );
  }

  /**
   * Picks a registered provider that can serve every option the request states,
   * in registration order.
   *
   * The failure message names which option ruled out which provider: with
   * several registered, "nothing satisfies this request" leaves an operator with
   * no way to tell whether to add a key, register another provider, or drop an
   * option.
   */
  route(request: WebSearchRequest): IWebSearchProvider {
    const candidates = this.list();
    if (candidates.length === 0) {
      throw new TaskConfigurationError(
        "WebSearchTask: No web-search providers are registered. Import @workglow/web-search " +
          "from a server runtime, or register one with registerWebSearchProvider()."
      );
    }
    const rejected: string[] = [];
    for (const candidate of candidates) {
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
