/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { LLAMACPP_CAPABILITY_SETS } from "./LlamaCpp_CapabilitySets";

export const LLAMACPP_RUN_FN_SPECS = LLAMACPP_CAPABILITY_SETS.map((serves) => ({ serves }));

export function llamaCppWorkerRunFnSpecs(): readonly {
  readonly serves: readonly Capability[];
}[] {
  return LLAMACPP_RUN_FN_SPECS;
}

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for a node-llama-cpp {@link ModelRecord}.
 *
 * llama.cpp is fully local — users download GGUF files explicitly. Like Ollama
 * the model space is open-ended. Declared caps win; otherwise the heuristic
 * looks at the filename (`provider_config.model_path` or the model_id) to
 * detect embedding vs generative GGUF files. Default is full generative.
 */
export function inferLlamaCppCapabilities(model: CapabilityHints): readonly Capability[] {
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;

  const id = String(
    model.model_id ??
      (model.provider_config as { model_path?: string; model_name?: string } | undefined)
        ?.model_path ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );
  const baseName = (id.split("/").pop() ?? id).toLowerCase();

  if (/embed|minilm|bge-|gte-|e5-/i.test(baseName)) {
    // No "cache.checkpoint" / "session.dispose": both act on a chat session,
    // which an embedding GGUF has no chat wrapper to build. Advertised, they
    // clear model selection and throw inside the provider; withheld, selection
    // rejects the model and says why.
    return [
      "text.embedding",
      "model.count-tokens",
      "model.download",
      "model.download-remove",
      "model.info",
      "model.search",
    ];
  }

  // Default for any other GGUF: full local generative model.
  if (baseName.length > 0) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "cache.checkpoint",
      "model.count-tokens",
      "model.download",
      "model.download-remove",
      "model.info",
      "model.search",
      "session.dispose",
    ];
  }

  return ["model.search", "model.info"];
}
