/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebSearchProvider } from "@workglow/web-search";
import type { GeminiWebSearchOptions } from "./web-search/GeminiWebSearchProvider";
import { GeminiWebSearchProvider } from "./web-search/GeminiWebSearchProvider";

export * from "./web-search/GeminiWebSearchProvider";

export function registerGeminiWebSearchProvider(options: GeminiWebSearchOptions = {}): void {
  registerWebSearchProvider(new GeminiWebSearchProvider(options));
}
