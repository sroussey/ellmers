/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebSearchProvider } from "@workglow/web-search";
import type { OpenAiWebSearchOptions } from "./web-search/OpenAiWebSearchProvider";
import { OpenAiWebSearchProvider } from "./web-search/OpenAiWebSearchProvider";

export * from "./web-search/OpenAiWebSearchProvider";

export function registerOpenAiWebSearchProvider(options: OpenAiWebSearchOptions = {}): void {
  registerWebSearchProvider(new OpenAiWebSearchProvider(options));
}
