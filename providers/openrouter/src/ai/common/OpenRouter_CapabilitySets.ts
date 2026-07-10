/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

export const OPENROUTER_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const OPENROUTER_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const OPENROUTER_JSON_MODE = [
  "text.generation",
  "json-mode",
] as const satisfies Capability[];
export const OPENROUTER_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const OPENROUTER_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const OPENROUTER_COUNT_TOKENS = ["model.count-tokens"] as const satisfies Capability[];
export const OPENROUTER_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const OPENROUTER_MODEL_INFO = ["model.info"] as const satisfies Capability[];

/** Aggregated list — order MUST match `OPENROUTER_RUN_FNS`. */
export const OPENROUTER_CAPABILITY_SETS = [
  OPENROUTER_TEXT_GENERATION,
  OPENROUTER_TOOL_USE,
  OPENROUTER_JSON_MODE,
  OPENROUTER_TEXT_REWRITER,
  OPENROUTER_TEXT_SUMMARY,
  OPENROUTER_COUNT_TOKENS,
  OPENROUTER_MODEL_SEARCH,
  OPENROUTER_MODEL_INFO,
] as const;
