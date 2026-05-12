/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

export const WEB_BROWSER_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const WEB_BROWSER_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const WEB_BROWSER_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const WEB_BROWSER_TEXT_TRANSLATION = ["text.translation"] as const satisfies Capability[];
export const WEB_BROWSER_TEXT_LANGUAGE_DETECTION = [
  "text.language-detection",
] as const satisfies Capability[];
export const WEB_BROWSER_MODEL_SEARCH = ["provider.model-search"] as const satisfies Capability[];
export const WEB_BROWSER_MODEL_INFO = ["provider.model-info"] as const satisfies Capability[];

export const WEB_BROWSER_CAPABILITY_SETS = [
  WEB_BROWSER_TEXT_GENERATION,
  WEB_BROWSER_TEXT_REWRITER,
  WEB_BROWSER_TEXT_SUMMARY,
  WEB_BROWSER_TEXT_TRANSLATION,
  WEB_BROWSER_TEXT_LANGUAGE_DETECTION,
  WEB_BROWSER_MODEL_SEARCH,
  WEB_BROWSER_MODEL_INFO,
] as const;
