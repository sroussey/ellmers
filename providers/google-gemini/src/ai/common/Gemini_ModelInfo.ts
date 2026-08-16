/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { createGeminiClient, getModelName } from "./Gemini_Client";
import { GOOGLE_GEMINI } from "./Gemini_Constants";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

/** Known Gemini embedding model dimensions. */
const GEMINI_EMBEDDING_DIMENSIONS: Record<string, { native_dimensions: number; mrl: boolean }> = {
  "text-embedding-004": { native_dimensions: 768, mrl: true },
  "embedding-001": { native_dimensions: 768, mrl: false },
};

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  const code = (err as { code?: unknown }).code;
  return status === 404 || statusCode === 404 || code === 404 || code === "NOT_FOUND";
}

/**
 * Confirm the model id exists on Gemini via `models.get`.
 */
async function assertGeminiModelExists(
  model: GeminiModelConfig | undefined,
  signal: AbortSignal | undefined
): Promise<string> {
  const modelName = getModelName(model);
  const client = await createGeminiClient(model);
  try {
    await client.models.get({
      model: modelName,
      config: signal ? { abortSignal: signal } : undefined,
    });
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new Error(
        `${GOOGLE_GEMINI} model "${modelName}" was not found (provider API returned not found)`
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
 * One-shot run-fn for `["model.info"]`. Verifies the model exists via Gemini's
 * `models.get`, then emits a remote info record. When `detail` is
 * `"dimensions"`, attaches known embedding dimensions after the check.
 */
export const Gemini_ModelInfo_Stream: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const modelName = await assertGeminiModelExists(model, signal);
  const base = remoteInfoBase(input);

  if (input.detail === "dimensions") {
    const pc = model?.provider_config as Record<string, unknown>;
    let native_dimensions =
      typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
    let mrl = typeof pc?.mrl === "boolean" ? pc.mrl : undefined;
    if (native_dimensions === undefined) {
      const known = GEMINI_EMBEDDING_DIMENSIONS[modelName];
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
