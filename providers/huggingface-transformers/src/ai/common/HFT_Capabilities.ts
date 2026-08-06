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
        "cache.checkpoint",
        "model.count-tokens",
        "model.download-remove",
        "model.info",
        "model.search",
      ];
    case "feature-extraction":
    case "sentence-similarity":
      return ["text.embedding", "model.download-remove", "model.info", "model.search"];
    case "text-classification":
      return ["text.classification", "model.download-remove", "model.info", "model.search"];
    case "token-classification":
      return ["text.ner", "model.download-remove", "model.info", "model.search"];
    case "fill-mask":
      return ["text.fill-mask", "model.download-remove", "model.info", "model.search"];
    case "translation":
      return ["text.translation", "model.download-remove", "model.info", "model.search"];
    case "summarization":
      return ["text.summary", "model.download-remove", "model.info", "model.search"];
    case "question-answering":
      return ["text.question-answering", "model.download-remove", "model.info", "model.search"];
    case "image-classification":
      return ["image.classification", "model.download-remove", "model.info", "model.search"];
    case "image-segmentation":
      return ["image.segmentation", "model.download-remove", "model.info", "model.search"];
    case "image-to-text":
      return ["image.to-text", "model.download-remove", "model.info", "model.search"];
    case "object-detection":
      return ["image.object-detection", "model.download-remove", "model.info", "model.search"];
    case "zero-shot-image-classification":
      return [
        "image.classification",
        "image.embedding",
        "model.download-remove",
        "model.info",
        "model.search",
      ];
  }

  // Fallback name-based pattern matching for repos without pipeline_task.
  const baseName = id.split("/").pop() ?? id;
  if (/embed|minilm|bge-|gte-|e5-/i.test(baseName)) {
    return ["text.embedding", "model.download-remove", "model.info", "model.search"];
  }
  if (/clip|siglip/i.test(baseName)) {
    return [
      "image.classification",
      "image.embedding",
      "model.download-remove",
      "model.info",
      "model.search",
    ];
  }
  if (/yolo|detr|owl/i.test(baseName)) {
    return ["image.object-detection", "model.download-remove", "model.info", "model.search"];
  }
  if (/sam|segformer|mask/i.test(baseName)) {
    return ["image.segmentation", "model.download-remove", "model.info", "model.search"];
  }
  if (/blip|llava|vision/i.test(baseName)) {
    return ["image.to-text", "model.download-remove", "model.info", "model.search"];
  }
  if (/llama|mistral|gemma|phi|qwen|tinyllama|smollm/i.test(baseName)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "cache.checkpoint",
      "model.count-tokens",
      "model.download-remove",
      "model.info",
      "model.search",
    ];
  }

  // Truly unknown — expose meta-ops only.
  return ["model.search", "model.info"];
}
