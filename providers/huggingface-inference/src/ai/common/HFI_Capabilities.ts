/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { HFI_CAPABILITY_SETS } from "./HFI_CapabilitySets";

export const HFI_RUN_FN_SPECS = HFI_CAPABILITY_SETS.map((serves) => ({ serves }));

export function hfInferenceWorkerRunFnSpecs(): readonly {
  readonly serves: readonly Capability[];
}[] {
  return HFI_RUN_FN_SPECS;
}

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for a HuggingFace Inference {@link ModelRecord}.
 *
 * HF Inference catalog items are HF Hub repo IDs (e.g. `mistralai/Mistral-7B-Instruct`,
 * `black-forest-labs/FLUX.1-dev`). Like HFT, declared capabilities (set by
 * model-search) win. Otherwise fall back to id patterns.
 */
export function inferHfInferenceCapabilities(model: CapabilityHints): readonly Capability[] {
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;

  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );
  const baseName = id.split("/").pop() ?? id;

  // Image generation / editing (Stable Diffusion, FLUX, SDXL, etc).
  if (/flux|stable-diffusion|sd-|sdxl|dall-e|kandinsky|wuerstchen|playground/i.test(baseName)) {
    return ["image.generation", "image.editing", "model.info", "model.search"];
  }

  // Embeddings.
  if (/embed|minilm|bge-|gte-|e5-/i.test(baseName)) {
    return ["text.embedding", "model.info", "model.search"];
  }

  // Generative text/chat models (Llama, Mistral, Mixtral, Gemma, Phi, Qwen, etc).
  if (
    /llama|mistral|mixtral|gemma|phi|qwen|falcon|yi|deepseek|command|claude|gpt-/i.test(baseName)
  ) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "model.info",
      "model.search",
    ];
  }

  return ["model.search", "model.info"];
}
