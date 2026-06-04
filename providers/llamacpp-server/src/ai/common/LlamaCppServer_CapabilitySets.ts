/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for llamacpp-server's capability sets.
 *
 * Both `LLAMACPP_SERVER_RUN_FNS` (worker-side registration) and
 * `workerRunFnSpecs()` derive their `serves` arrays from these named exports.
 * SDK-free so the main thread can import them without pulling in fetch code.
 */
export const LLAMACPP_SERVER_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];

export const LLAMACPP_SERVER_TOOL_USE = [
  "text.generation",
  "tool-use",
] as const satisfies Capability[];

export const LLAMACPP_SERVER_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const LLAMACPP_SERVER_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const LLAMACPP_SERVER_TEXT_EMBEDDING = ["text.embedding"] as const satisfies Capability[];
export const LLAMACPP_SERVER_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const LLAMACPP_SERVER_MODEL_INFO = ["model.info"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. */
export const LLAMACPP_SERVER_CAPABILITY_SETS = [
  LLAMACPP_SERVER_TEXT_GENERATION,
  LLAMACPP_SERVER_TOOL_USE,
  LLAMACPP_SERVER_TEXT_REWRITER,
  LLAMACPP_SERVER_TEXT_SUMMARY,
  LLAMACPP_SERVER_TEXT_EMBEDDING,
  LLAMACPP_SERVER_MODEL_SEARCH,
  LLAMACPP_SERVER_MODEL_INFO,
] as const;
