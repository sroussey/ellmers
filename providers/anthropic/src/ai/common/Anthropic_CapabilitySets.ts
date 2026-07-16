/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for Anthropic's capability sets.
 *
 * Both `ANTHROPIC_RUN_FNS` (the worker-side registration list) and
 * `workerRunFnSpecs()` (the main-thread proxy declaration) derive their
 * `serves` arrays from these named exports. SDK-free so the main thread
 * can import without paying the Anthropic client cost.
 *
 * To add a new capability set: declare a new `as const` constant here,
 * then reference it from both `ANTHROPIC_RUN_FNS` and `ANTHROPIC_RUN_FN_SPECS`.
 *
 * Note: Anthropic does NOT support embeddings, image generation, or image editing.
 * Structured generation is implemented via Anthropic's tool-use API under the hood,
 * but it is registered under `["text.generation", "json-mode"]` per the capability
 * dispatch model so the consumer receives a parsed object in `finish.data.object`.
 */
export const ANTHROPIC_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const ANTHROPIC_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const ANTHROPIC_JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
export const ANTHROPIC_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const ANTHROPIC_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const ANTHROPIC_COUNT_TOKENS = ["model.count-tokens"] as const satisfies Capability[];
export const ANTHROPIC_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const ANTHROPIC_MODEL_INFO = ["model.info"] as const satisfies Capability[];
export const ANTHROPIC_CACHE_CHECKPOINT = ["cache.checkpoint"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. Order MUST match `ANTHROPIC_RUN_FNS`; validated by the `capability-set parity` test in `AnthropicProvider.test.ts`. */
export const ANTHROPIC_CAPABILITY_SETS = [
  ANTHROPIC_TEXT_GENERATION,
  ANTHROPIC_TOOL_USE,
  ANTHROPIC_JSON_MODE,
  ANTHROPIC_TEXT_REWRITER,
  ANTHROPIC_TEXT_SUMMARY,
  ANTHROPIC_COUNT_TOKENS,
  ANTHROPIC_MODEL_SEARCH,
  ANTHROPIC_MODEL_INFO,
  ANTHROPIC_CACHE_CHECKPOINT,
] as const;
