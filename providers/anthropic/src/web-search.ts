/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebSearchProvider } from "@workglow/web-search";
import type { AnthropicWebSearchOptions } from "./web-search/AnthropicWebSearchProvider";
import { AnthropicWebSearchProvider } from "./web-search/AnthropicWebSearchProvider";

export * from "./web-search/AnthropicWebSearchProvider";

export function registerAnthropicWebSearchProvider(options: AnthropicWebSearchOptions = {}): void {
  registerWebSearchProvider(new AnthropicWebSearchProvider(options));
}
