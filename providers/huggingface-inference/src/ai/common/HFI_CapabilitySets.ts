/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for HuggingFace Inference's capability sets.
 *
 * Both `HFI_RUN_FNS` (worker-side registration) and `workerRunFnSpecs()`
 * (main-thread proxy declaration) derive their `serves` arrays from these
 * named exports. SDK-free so the main thread can import without paying the
 * `@huggingface/inference` cost.
 */
export const HFI_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const HFI_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const HFI_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const HFI_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const HFI_TEXT_EMBEDDING = ["text.embedding"] as const satisfies Capability[];
export const HFI_IMAGE_GENERATION = ["image.generation"] as const satisfies Capability[];
export const HFI_IMAGE_EDITING = ["image.editing"] as const satisfies Capability[];
export const HFI_MODEL_SEARCH = ["provider.model-search"] as const satisfies Capability[];
export const HFI_MODEL_INFO = ["provider.model-info"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. Order MUST match `HFI_RUN_FNS`. */
export const HFI_CAPABILITY_SETS = [
  HFI_TEXT_GENERATION,
  HFI_TOOL_USE,
  HFI_TEXT_REWRITER,
  HFI_TEXT_SUMMARY,
  HFI_TEXT_EMBEDDING,
  HFI_IMAGE_GENERATION,
  HFI_IMAGE_EDITING,
  HFI_MODEL_SEARCH,
  HFI_MODEL_INFO,
] as const;
