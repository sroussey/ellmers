/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export * from "./common/OpenRouter_Constants";
export * from "./common/OpenRouter_Capabilities";

import { buildChatParams, buildOpenRouterExtras } from "./common/OpenRouter_RequestParams";
import { mapOpenRouterModels } from "./common/OpenRouter_ModelSearch";

/** @internal Symbols exported only for `@workglow/test`. Not a stable API. */
export const _testOnly = {
  buildChatParams,
  buildOpenRouterExtras,
  mapOpenRouterModels,
} as const;
