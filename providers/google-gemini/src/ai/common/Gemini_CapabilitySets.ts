/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for Google Gemini's capability sets.
 *
 * Both `GEMINI_RUN_FNS` (the worker-side registration list) and
 * `workerRunFnSpecs()` (the main-thread proxy declaration) derive their
 * `serves` arrays from these named exports. SDK-free so the main thread
 * can import without paying the Gemini client cost.
 *
 * To add a new capability set: declare a new `as const` constant here,
 * then reference it from both `GEMINI_RUN_FNS` and `GEMINI_RUN_FN_SPECS`.
 */
export const GEMINI_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const GEMINI_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const GEMINI_JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
export const GEMINI_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const GEMINI_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const GEMINI_TEXT_EMBEDDING = ["text.embedding"] as const satisfies Capability[];
export const GEMINI_IMAGE_GENERATION = ["image.generation"] as const satisfies Capability[];
export const GEMINI_IMAGE_EDITING = ["image.editing"] as const satisfies Capability[];
export const GEMINI_COUNT_TOKENS = ["model.count-tokens"] as const satisfies Capability[];
export const GEMINI_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const GEMINI_MODEL_INFO = ["model.info"] as const satisfies Capability[];
export const GEMINI_CACHE_CHECKPOINT = ["cache.checkpoint"] as const satisfies Capability[];
export const GEMINI_SESSION_DISPOSE = ["session.dispose"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. Order MUST match `GEMINI_RUN_FNS`. */
export const GEMINI_CAPABILITY_SETS = [
  GEMINI_TEXT_GENERATION,
  GEMINI_TOOL_USE,
  GEMINI_JSON_MODE,
  GEMINI_TEXT_REWRITER,
  GEMINI_TEXT_SUMMARY,
  GEMINI_TEXT_EMBEDDING,
  GEMINI_IMAGE_GENERATION,
  GEMINI_IMAGE_EDITING,
  GEMINI_COUNT_TOKENS,
  GEMINI_MODEL_SEARCH,
  GEMINI_MODEL_INFO,
  GEMINI_CACHE_CHECKPOINT,
  GEMINI_SESSION_DISPOSE,
] as const;
