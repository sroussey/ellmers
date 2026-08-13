/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { getClient, getModelName } from "./Xai_Client";
import { XAI } from "./Xai_Constants";
import type { XaiModelConfig } from "./Xai_ModelSchema";

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  const code = (err as { code?: unknown }).code;
  return status === 404 || statusCode === 404 || code === "model_not_found";
}

async function assertXaiModelExists(
  model: XaiModelConfig | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  const modelName = getModelName(model);
  const client = await getClient(model);
  try {
    await client.models.retrieve(modelName, signal ? { signal } : undefined);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new Error(
        `${XAI} model "${modelName}" was not found (provider API returned not found)`
      );
    }
    throw err;
  }
}

/**
 * One-shot run-fn for `["model.info"]`. Verifies the model exists via xAI's
 * OpenAI-compatible `models.retrieve`, then emits a remote info record.
 */
export const Xai_ModelInfo_Stream: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  XaiModelConfig
> = async (input, model, signal, emit) => {
  await assertXaiModelExists(model, signal);
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
