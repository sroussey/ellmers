/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { getClient } from "./OpenAI_Client";
import { OPENAI } from "./OpenAI_Constants";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/** Known OpenAI embedding model dimensions. */
const OPENAI_EMBEDDING_DIMENSIONS: Record<string, { native_dimensions: number; mrl: boolean }> = {
  "text-embedding-3-small": { native_dimensions: 1536, mrl: true },
  "text-embedding-3-large": { native_dimensions: 3072, mrl: true },
  "text-embedding-ada-002": { native_dimensions: 1536, mrl: false },
};

function modelNameOf(model: OpenAiModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  const code = (err as { code?: unknown }).code;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  return status === 404 || statusCode === 404 || code === "model_not_found";
}

/**
 * Confirm the model id exists on OpenAI via `models.retrieve`. Throws naming
 * the provider and id when the API reports the model missing; other errors
 * propagate (auth/network).
 */
async function assertOpenAiModelExists(
  model: OpenAiModelConfig | undefined,
  signal: AbortSignal | undefined
): Promise<string> {
  const modelName = modelNameOf(model);
  const client = await getClient(model);
  try {
    await client.models.retrieve(modelName, signal ? { signal } : undefined);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new Error(
        `${OPENAI} model "${modelName}" was not found (provider API returned not found)`
      );
    }
    throw err;
  }
  return modelName;
}

function remoteInfoBase(input: ModelInfoTaskInput): ModelInfoTaskOutput {
  return {
    model: input.model,
    is_local: false,
    is_remote: true,
    supports_browser: true,
    supports_node: true,
    is_cached: false,
    is_loaded: false,
    file_sizes: null,
  };
}

/**
 * One-shot run-fn for `["model.info"]`. Verifies the model exists via
 * OpenAI's `models.retrieve`, then emits a remote info record. When
 * `detail` is `"dimensions"`, attaches known embedding dimensions after
 * the existence check.
 */
export const OpenAI_ModelInfo_Stream: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  OpenAiModelConfig
> = async (input, model, signal, emit) => {
  const modelName = await assertOpenAiModelExists(model, signal);
  const base = remoteInfoBase(input);

  if (input.detail === "dimensions") {
    const pc = model?.provider_config as Record<string, unknown>;
    let native_dimensions =
      typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
    let mrl = typeof pc?.mrl === "boolean" ? pc.mrl : undefined;

    if (native_dimensions === undefined) {
      const known = OPENAI_EMBEDDING_DIMENSIONS[modelName];
      if (known) {
        native_dimensions = known.native_dimensions;
        mrl = mrl ?? known.mrl;
      }
    }

    emit({
      type: "finish",
      data: {
        ...base,
        ...(native_dimensions !== undefined ? { native_dimensions } : {}),
        ...(mrl !== undefined ? { mrl } : {}),
      },
    });
    return;
  }

  emit({ type: "finish", data: base });
};
