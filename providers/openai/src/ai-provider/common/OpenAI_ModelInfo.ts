/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/** Known OpenAI embedding model dimensions. */
const OPENAI_EMBEDDING_DIMENSIONS: Record<string, { native_dimensions: number; mrl: boolean }> = {
  "text-embedding-3-small": { native_dimensions: 1536, mrl: true },
  "text-embedding-3-large": { native_dimensions: 3072, mrl: true },
  "text-embedding-ada-002": { native_dimensions: 1536, mrl: false },
};

export const OpenAI_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  OpenAiModelConfig
> = async (input, model) => {
  if (input.detail === "dimensions") {
    const pc = model?.provider_config as Record<string, unknown>;
    let native_dimensions =
      typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
    let mrl = typeof pc?.mrl === "boolean" ? pc.mrl : undefined;

    // Lookup table fallback
    if (native_dimensions === undefined) {
      const modelName = (pc?.model_name as string) ?? "";
      const known = OPENAI_EMBEDDING_DIMENSIONS[modelName];
      if (known) {
        native_dimensions = known.native_dimensions;
        mrl = mrl ?? known.mrl;
      }
    }

    return {
      model: input.model,
      is_local: false,
      is_remote: true,
      supports_browser: true,
      supports_node: true,
      is_cached: false,
      is_loaded: false,
      file_sizes: null,
      ...(native_dimensions !== undefined ? { native_dimensions } : {}),
      ...(mrl !== undefined ? { mrl } : {}),
    };
  }

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
};
