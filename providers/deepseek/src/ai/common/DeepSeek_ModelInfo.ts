/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { getClient, getModelName } from "./DeepSeek_Client";
import { DEEPSEEK } from "./DeepSeek_Constants";
import type { DeepSeekModelConfig } from "./DeepSeek_ModelSchema";

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  const code = (err as { code?: unknown }).code;
  return status === 404 || statusCode === 404 || code === "model_not_found";
}

async function assertDeepSeekModelExists(
  model: DeepSeekModelConfig | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  const modelName = getModelName(model);
  const client = await getClient(model);
  try {
    await client.models.retrieve(modelName, signal ? { signal } : undefined);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new Error(
        `${DEEPSEEK} model "${modelName}" was not found (provider API returned not found)`
      );
    }
    throw err;
  }
}

/**
 * One-shot run-fn for `["model.info"]`. Verifies the model exists via DeepSeek's
 * OpenAI-compatible `models.retrieve`, then emits a remote info record.
 */
export const DeepSeek_ModelInfo_Stream: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  DeepSeekModelConfig
> = async (input, model, signal, emit) => {
  await assertDeepSeekModelExists(model, signal);
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
