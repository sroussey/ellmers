/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { BraveWebSearchProvider } from "./providers/BraveWebSearchProvider";
import {
  SEARXNG_BASE_URL_ENV,
  SearxngWebSearchProvider,
} from "./providers/SearxngWebSearchProvider";
import { TavilyWebSearchProvider } from "./providers/TavilyWebSearchProvider";
import { WebSearchProviderRegistry } from "./WebSearchProviderRegistry";
import { WebSearchTask } from "./WebSearchTask";

export * from "./capabilityCheck";
export * from "./IWebSearchProvider";
export * from "./limitResults";
export * from "./providers/BraveWebSearchProvider";
export * from "./providers/httpSearch";
export * from "./providers/SearxngWebSearchProvider";
export * from "./providers/TavilyWebSearchProvider";
export * from "./publishedDate";
export * from "./queryOperators";
export * from "./urlText";
export * from "./WebSearchProviderRegistry";
export * from "./WebSearchTask";

export function registerWebSearchTasks(): void {
  TaskRegistry.registerTask(WebSearchTask);
}

export interface BuiltInWebSearchProviderOptions {
  /**
   * SearXNG instance to search. Falls back to {@link SEARXNG_BASE_URL_ENV}.
   * With neither, SearXNG is skipped — it is self-hosted, so unlike the keyed
   * providers there is no address to guess.
   */
  readonly searxngBaseUrl?: string | undefined;
}

export function registerBuiltInWebSearchProviders(
  options: BuiltInWebSearchProviderOptions = {}
): void {
  WebSearchProviderRegistry.register(new BraveWebSearchProvider());
  WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
  const searxngBaseUrl =
    options.searxngBaseUrl ??
    (typeof process !== "undefined" ? process.env?.[SEARXNG_BASE_URL_ENV] : undefined);
  if (searxngBaseUrl) {
    WebSearchProviderRegistry.register(new SearxngWebSearchProvider(searxngBaseUrl));
  }
}
