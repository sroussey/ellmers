/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebSearchProvider } from "@workglow/web-search";
import type { OpenRouterWebSearchOptions } from "./web-search/OpenRouterWebSearchProvider";
import { OpenRouterWebSearchProvider } from "./web-search/OpenRouterWebSearchProvider";

export * from "./web-search/OpenRouterWebSearchProvider";

export function registerOpenRouterWebSearchProvider(
  options: OpenRouterWebSearchOptions = {}
): void {
  registerWebSearchProvider(new OpenRouterWebSearchProvider(options));
}
