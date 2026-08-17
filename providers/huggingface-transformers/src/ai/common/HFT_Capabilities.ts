/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { HFT_CAPABILITY_SETS } from "./HFT_CapabilitySets";

export const HFT_RUN_FN_SPECS = HFT_CAPABILITY_SETS.map((serves) => ({ serves }));

export function hftWorkerRunFnSpecs(): readonly { readonly serves: readonly Capability[] }[] {
  return HFT_RUN_FN_SPECS;
}

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

const HFT_META = [
  "model.download",
  "model.download-remove",
  "model.info",
  "model.search",
] as const satisfies readonly Capability[];

/**
 * Heuristic capability inference for a HuggingFace Transformers
 * {@link ModelRecord}.
 *
 * HFT model ids come from the HF Hub catalog (e.g. `Xenova/all-MiniLM-L6-v2`,
 * `onnx-community/Llama-3.2-1B-Instruct-q4f16`, `Xenova/clip-vit-base-patch32`).
 * Heuristics inspect a normalized suffix and `provider_config.pipeline_task`
 * if present (HF tags each repo with a pipeline-task hint).
 *
 * If `capabilities` is already declared on the record, those win unconditionally
 * (HF Hub repo metadata is the most authoritative signal we have).
 */
export function inferHftCapabilities(model: CapabilityHints): readonly Capability[] {
  // Authoritative path: trust declared capabilities (the model-search step
  // populates these from HF Hub tags).
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;

  const id = String(
    model.model_id ??
      (model.provider_config as { model_path?: string; model_name?: string } | undefined)
        ?.model_path ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );

  const pipelineTask =
    (model.provider_config as { pipeline_task?: string } | undefined)?.pipeline_task ?? "";

  // Use the pipeline-task hint first if it's set (most reliable).
  switch (pipelineTask) {
    case "text-generation":
      return [
        "text.generation",
        "text.rewriter",
        "text.summary",
        "tool-use",
        "json-mode",
        "cache.checkpoint",
        "session.dispose",
        "model.count-tokens",
        ...HFT_META,
      ];
    case "feature-extraction":
    case "sentence-similarity":
      return ["text.embedding", ...HFT_META];
    case "text-classification":
      return ["text.classification", ...HFT_META];
    case "token-classification":
      return ["text.ner", ...HFT_META];
    case "fill-mask":
      return ["text.fill-mask", ...HFT_META];
    case "translation":
      return ["text.translation", ...HFT_META];
    case "summarization":
      return ["text.summary", ...HFT_META];
    case "question-answering":
      return ["text.question-answering", ...HFT_META];
    case "image-classification":
      return ["image.classification", ...HFT_META];
    case "image-segmentation":
      return ["image.segmentation", ...HFT_META];
    case "image-to-text":
      return ["image.to-text", ...HFT_META];
    case "object-detection":
      return ["image.object-detection", ...HFT_META];
    case "background-removal":
      return ["image.background-removal", ...HFT_META];
    case "zero-shot-image-classification":
      return ["image.classification", "image.embedding", ...HFT_META];
  }

  // Fallback name-based pattern matching for repos without pipeline_task.
  const baseName = id.split("/").pop() ?? id;
  // Rerankers share `bge-` with embedders; match them first so they don't
  // collapse into text.embedding.
  if (/rerank/i.test(baseName)) {
    return ["text.reranking", ...HFT_META];
  }
  if (/language.?detect|langid/i.test(baseName)) {
    return ["text.language-detection", ...HFT_META];
  }
  if (/embed|minilm|bge-|gte-|e5-/i.test(baseName)) {
    return ["text.embedding", ...HFT_META];
  }
  if (/clip|siglip/i.test(baseName)) {
    return ["image.classification", "image.embedding", ...HFT_META];
  }
  if (/yolo|detr|owl/i.test(baseName)) {
    return ["image.object-detection", ...HFT_META];
  }
  if (/sam|segformer|mask/i.test(baseName)) {
    return ["image.segmentation", ...HFT_META];
  }
  if (/blip|llava|vision/i.test(baseName)) {
    return ["image.to-text", ...HFT_META];
  }
  if (/llama|mistral|gemma|phi|qwen|tinyllama|smollm/i.test(baseName)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "cache.checkpoint",
      "session.dispose",
      "model.count-tokens",
      ...HFT_META,
    ];
  }

  // Truly unknown — expose meta-ops only.
  return ["model.search", "model.info"];
}
