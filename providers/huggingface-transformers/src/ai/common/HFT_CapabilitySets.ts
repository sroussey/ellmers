/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";

/**
 * Single source of truth for HuggingFace Transformers' capability sets.
 *
 * Both `HFT_RUN_FNS` (worker-side registration) and `workerRunFnSpecs()`
 * (main-thread proxy declaration) derive their `serves` arrays from these
 * named exports. SDK-free so the main thread can import without paying the
 * `@huggingface/transformers` cost.
 */
export const HFT_TEXT_GENERATION = ["text.generation"] as const satisfies Capability[];
export const HFT_TOOL_USE = ["text.generation", "tool-use"] as const satisfies Capability[];
export const HFT_JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
export const HFT_TEXT_REWRITER = ["text.rewriter"] as const satisfies Capability[];
export const HFT_TEXT_SUMMARY = ["text.summary"] as const satisfies Capability[];
export const HFT_TEXT_TRANSLATION = ["text.translation"] as const satisfies Capability[];
export const HFT_TEXT_QUESTION_ANSWERING = [
  "text.question-answering",
] as const satisfies Capability[];
export const HFT_TEXT_EMBEDDING = ["text.embedding"] as const satisfies Capability[];
export const HFT_TEXT_CLASSIFICATION = ["text.classification"] as const satisfies Capability[];
export const HFT_TEXT_LANGUAGE_DETECTION = [
  "text.language-detection",
] as const satisfies Capability[];
export const HFT_TEXT_FILL_MASK = ["text.fill-mask"] as const satisfies Capability[];
export const HFT_TEXT_NER = ["text.ner"] as const satisfies Capability[];
export const HFT_IMAGE_CLASSIFICATION = ["image.classification"] as const satisfies Capability[];
export const HFT_IMAGE_EMBEDDING = ["image.embedding"] as const satisfies Capability[];
export const HFT_IMAGE_SEGMENTATION = ["image.segmentation"] as const satisfies Capability[];
export const HFT_IMAGE_TO_TEXT = ["image.to-text"] as const satisfies Capability[];
export const HFT_IMAGE_BACKGROUND_REMOVAL = [
  "image.background-removal",
] as const satisfies Capability[];
export const HFT_IMAGE_OBJECT_DETECTION = [
  "image.object-detection",
] as const satisfies Capability[];
export const HFT_COUNT_TOKENS = ["model.count-tokens"] as const satisfies Capability[];
export const HFT_MODEL_UNLOAD = ["model.unload"] as const satisfies Capability[];
export const HFT_MODEL_DOWNLOAD = ["model.download"] as const satisfies Capability[];
export const HFT_MODEL_SEARCH = ["provider.model-search"] as const satisfies Capability[];
export const HFT_MODEL_INFO = ["provider.model-info"] as const satisfies Capability[];

/** Aggregated list — for `workerRunFnSpecs()` derivation. Order MUST match `HFT_RUN_FNS`. */
export const HFT_CAPABILITY_SETS = [
  HFT_TEXT_GENERATION,
  HFT_TOOL_USE,
  HFT_JSON_MODE,
  HFT_TEXT_REWRITER,
  HFT_TEXT_SUMMARY,
  HFT_TEXT_TRANSLATION,
  HFT_TEXT_QUESTION_ANSWERING,
  HFT_TEXT_EMBEDDING,
  HFT_TEXT_CLASSIFICATION,
  HFT_TEXT_LANGUAGE_DETECTION,
  HFT_TEXT_FILL_MASK,
  HFT_TEXT_NER,
  HFT_IMAGE_CLASSIFICATION,
  HFT_IMAGE_EMBEDDING,
  HFT_IMAGE_SEGMENTATION,
  HFT_IMAGE_TO_TEXT,
  HFT_IMAGE_BACKGROUND_REMOVAL,
  HFT_IMAGE_OBJECT_DETECTION,
  HFT_COUNT_TOKENS,
  HFT_MODEL_UNLOAD,
  HFT_MODEL_DOWNLOAD,
  HFT_MODEL_SEARCH,
  HFT_MODEL_INFO,
] as const;
