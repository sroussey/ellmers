/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for xAI's capability sets.
 *
 * Both `XAI_RUN_FNS` (the worker-side registration list) and
 * `workerRunFnSpecs()` (the main-thread proxy declaration) derive their
 * `serves` arrays from these named exports. SDK-free so the main thread can
 * import without paying the OpenAI client cost.
 *
 * To add a new capability set: declare a new `as const` constant here, then
 * reference it from both `XAI_RUN_FNS` and `XAI_RUN_FN_SPECS`.
 */
export const XAI_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const XAI_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const XAI_JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
export const XAI_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const XAI_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const XAI_IMAGE_GENERATION = ["image.generation"] as const satisfies Capability[];
export const XAI_COUNT_TOKENS = ["model.count-tokens"] as const satisfies Capability[];
export const XAI_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const XAI_MODEL_INFO = ["model.info"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. Order MUST match `XAI_RUN_FNS`. */
export const XAI_CAPABILITY_SETS = [
  XAI_TEXT_GENERATION,
  XAI_TOOL_USE,
  XAI_JSON_MODE,
  XAI_TEXT_REWRITER,
  XAI_TEXT_SUMMARY,
  XAI_IMAGE_GENERATION,
  XAI_COUNT_TOKENS,
  XAI_MODEL_SEARCH,
  XAI_MODEL_INFO,
] as const;
