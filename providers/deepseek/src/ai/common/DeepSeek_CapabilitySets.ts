/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for DeepSeek's capability sets.
 *
 * Both `DEEPSEEK_RUN_FNS` (the worker-side registration list) and
 * `workerRunFnSpecs()` (the main-thread proxy declaration) derive their
 * `serves` arrays from these named exports. SDK-free so the main thread can
 * import without paying the OpenAI client cost.
 *
 * To add a new capability set: declare a new `as const` constant here, then
 * reference it from both `DEEPSEEK_RUN_FNS` and `DEEPSEEK_RUN_FN_SPECS`.
 */
export const DEEPSEEK_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const DEEPSEEK_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const DEEPSEEK_JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
export const DEEPSEEK_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const DEEPSEEK_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const DEEPSEEK_COUNT_TOKENS = ["model.count-tokens"] as const satisfies Capability[];
export const DEEPSEEK_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const DEEPSEEK_MODEL_INFO = ["model.info"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. Order MUST match `DEEPSEEK_RUN_FNS`. */
export const DEEPSEEK_CAPABILITY_SETS = [
  DEEPSEEK_TEXT_GENERATION,
  DEEPSEEK_TOOL_USE,
  DEEPSEEK_JSON_MODE,
  DEEPSEEK_TEXT_REWRITER,
  DEEPSEEK_TEXT_SUMMARY,
  DEEPSEEK_COUNT_TOKENS,
  DEEPSEEK_MODEL_SEARCH,
  DEEPSEEK_MODEL_INFO,
] as const;
