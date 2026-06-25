/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for Ollama's capability sets.
 *
 * Both `OLLAMA_RUN_FNS` (worker-side registration) and `workerRunFnSpecs()`
 * (main-thread proxy declaration) derive their `serves` arrays from these
 * named exports. SDK-free so the main thread can import without paying the
 * Ollama client cost.
 */
export const OLLAMA_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const OLLAMA_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const OLLAMA_JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
export const OLLAMA_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const OLLAMA_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const OLLAMA_TEXT_EMBEDDING = ["text.embedding"] as const satisfies Capability[];
export const OLLAMA_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const OLLAMA_MODEL_INFO = ["model.info"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. Order MUST match `OLLAMA_RUN_FNS`. */
export const OLLAMA_CAPABILITY_SETS = [
  OLLAMA_TEXT_GENERATION,
  OLLAMA_TOOL_USE,
  OLLAMA_JSON_MODE,
  OLLAMA_TEXT_REWRITER,
  OLLAMA_TEXT_SUMMARY,
  OLLAMA_TEXT_EMBEDDING,
  OLLAMA_MODEL_SEARCH,
  OLLAMA_MODEL_INFO,
] as const;
