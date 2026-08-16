/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { getClient } from "./Anthropic_Client";
import { ANTHROPIC } from "./Anthropic_Constants";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

function modelNameOf(model: AnthropicModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  return status === 404 || statusCode === 404;
}

/**
 * Confirm the model id exists on Anthropic via `beta.models.retrieve`.
 */
async function assertAnthropicModelExists(
  model: AnthropicModelConfig | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  const modelName = modelNameOf(model);
  const client = await getClient(model);
  try {
    await client.beta.models.retrieve(modelName, null, signal ? { signal } : undefined);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new Error(
        `${ANTHROPIC} model "${modelName}" was not found (provider API returned not found)`
      );
    }
    throw err;
  }
}

/**
 * One-shot run-fn for `["model.info"]`. Verifies the model exists via
 * Anthropic's models API, then emits a remote info record.
 */
export const Anthropic_ModelInfo_Stream: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  AnthropicModelConfig
> = async (input, model, signal, emit) => {
  await assertAnthropicModelExists(model, signal);
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
