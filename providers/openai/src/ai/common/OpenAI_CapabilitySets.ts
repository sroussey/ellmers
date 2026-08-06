/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for OpenAI's capability sets.
 *
 * Both `OPENAI_RUN_FNS` (the worker-side registration list) and
 * `workerRunFnSpecs()` (the main-thread proxy declaration) derive their
 * `serves` arrays from these named exports. SDK-free so the main thread
 * can import without paying the OpenAI client cost.
 *
 * To add a new capability set: declare a new `as const` constant here,
 * then reference it from both `OPENAI_RUN_FNS` and `OPENAI_RUN_FN_SPECS`.
 */
export const OPENAI_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const OPENAI_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const OPENAI_JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
export const OPENAI_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const OPENAI_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const OPENAI_TEXT_EMBEDDING = ["text.embedding"] as const satisfies Capability[];
export const OPENAI_IMAGE_GENERATION = ["image.generation"] as const satisfies Capability[];
export const OPENAI_IMAGE_EDITING = ["image.editing"] as const satisfies Capability[];
export const OPENAI_COUNT_TOKENS = ["model.count-tokens"] as const satisfies Capability[];
export const OPENAI_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const OPENAI_MODEL_INFO = ["model.info"] as const satisfies Capability[];
export const OPENAI_CACHE_CHECKPOINT = ["cache.checkpoint"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. Order MUST match `OPENAI_RUN_FNS`. */
export const OPENAI_CAPABILITY_SETS = [
  OPENAI_TEXT_GENERATION,
  OPENAI_TOOL_USE,
  OPENAI_JSON_MODE,
  OPENAI_TEXT_REWRITER,
  OPENAI_TEXT_SUMMARY,
  OPENAI_TEXT_EMBEDDING,
  OPENAI_IMAGE_GENERATION,
  OPENAI_IMAGE_EDITING,
  OPENAI_COUNT_TOKENS,
  OPENAI_MODEL_SEARCH,
  OPENAI_MODEL_INFO,
  OPENAI_CACHE_CHECKPOINT,
] as const;
