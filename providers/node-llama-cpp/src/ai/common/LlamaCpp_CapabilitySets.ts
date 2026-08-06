/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

export const LLAMACPP_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const LLAMACPP_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const LLAMACPP_JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
export const LLAMACPP_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const LLAMACPP_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const LLAMACPP_TEXT_EMBEDDING = ["text.embedding"] as const satisfies Capability[];
export const LLAMACPP_COUNT_TOKENS = ["model.count-tokens"] as const satisfies Capability[];
export const LLAMACPP_MODEL_UNLOAD = ["model.download-remove"] as const satisfies Capability[];
export const LLAMACPP_MODEL_DOWNLOAD = ["model.download"] as const satisfies Capability[];
export const LLAMACPP_MODEL_SEARCH = ["model.search"] as const satisfies Capability[];
export const LLAMACPP_MODEL_INFO = ["model.info"] as const satisfies Capability[];
export const LLAMACPP_CACHE_CHECKPOINT = ["cache.checkpoint"] as const satisfies Capability[];
export const LLAMACPP_SESSION_DISPOSE = ["session.dispose"] as const satisfies Capability[];

export const LLAMACPP_CAPABILITY_SETS = [
  LLAMACPP_TEXT_GENERATION,
  LLAMACPP_TOOL_USE,
  LLAMACPP_JSON_MODE,
  LLAMACPP_TEXT_REWRITER,
  LLAMACPP_TEXT_SUMMARY,
  LLAMACPP_TEXT_EMBEDDING,
  LLAMACPP_COUNT_TOKENS,
  LLAMACPP_MODEL_UNLOAD,
  LLAMACPP_MODEL_DOWNLOAD,
  LLAMACPP_MODEL_SEARCH,
  LLAMACPP_MODEL_INFO,
  LLAMACPP_CACHE_CHECKPOINT,
  LLAMACPP_SESSION_DISPOSE,
] as const;
