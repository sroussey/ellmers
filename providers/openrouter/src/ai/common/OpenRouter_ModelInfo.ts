/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { OPENROUTER } from "./OpenRouter_Constants";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";

function modelNameOf(model: OpenRouterModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

/**
 * Fetch OpenRouter's public model catalog and require an exact id match.
 * Never treats the curated FALLBACK list as proof the model exists — a failed
 * or empty catalog response is an error.
 */
async function assertOpenRouterModelExists(
  model: OpenRouterModelConfig | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  const modelName = modelNameOf(model);
  const baseUrl =
    (model?.provider_config as { base_url?: string } | undefined)?.base_url?.replace(/\/$/, "") ??
    "https://openrouter.ai/api/v1";
  const res = await fetch(`${baseUrl}/models`, { signal });
  if (!res.ok) {
    throw new Error(
      `${OPENROUTER} model "${modelName}" lookup failed (OpenRouter API returned ${res.status})`
    );
  }
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  const models = Array.isArray(body.data) ? body.data : [];
  if (models.length === 0) {
    throw new Error(
      `${OPENROUTER} model "${modelName}" lookup failed (OpenRouter returned an empty catalog)`
    );
  }
  if (!models.some((m) => m.id === modelName)) {
    throw new Error(
      `${OPENROUTER} model "${modelName}" was not found (provider API returned not found)`
    );
  }
}

/**
 * One-shot run-fn for `["model.info"]`. Verifies the model id exists in
 * OpenRouter's live `/models` catalog (exact match; no FALLBACK), then emits a
 * remote info record.
 */
export const OpenRouter_ModelInfo_Stream: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  OpenRouterModelConfig
> = async (input, model, signal, emit) => {
  await assertOpenRouterModelExists(model, signal);
  emit({
    type: "finish",
    data: {
      model: input.model,
      is_local: false,
      is_remote: true,
      supports_browser: true,
      supports_node: true,
      is_cached: false,
      is_loaded: false,
      file_sizes: null,
    },
  });
};
