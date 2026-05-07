/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { modelTaskCache } from "./TFMP_Runtime";

/** Known MediaPipe embedding model dimensions. */
const TFMP_EMBEDDING_DIMENSIONS: Record<string, { native_dimensions: number; mrl: boolean }> = {
  "universal-sentence-encoder": { native_dimensions: 512, mrl: false },
};

export const TFMP_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  TFMPModelConfig
> = async (input, model) => {
  if (input.detail === "dimensions") {
    const pc = model?.provider_config as Record<string, unknown>;
    let native_dimensions =
      typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
    const mrl = typeof pc?.mrl === "boolean" ? pc.mrl : false;
    if (native_dimensions === undefined) {
      const modelPath = (pc?.model_path as string) ?? "";
      const known = TFMP_EMBEDDING_DIMENSIONS[modelPath];
      if (known) {
        native_dimensions = known.native_dimensions;
      }
    }
    return {
      model: input.model,
      is_local: true,
      is_remote: false,
      supports_browser: true,
      supports_node: false,
      is_cached: false,
      is_loaded: false,
      file_sizes: null,
      ...(native_dimensions !== undefined ? { native_dimensions } : {}),
      ...(mrl ? { mrl } : {}),
    };
  }

  const model_path = model!.provider_config.model_path;
  const is_loaded = modelTaskCache.has(model_path);

  return {
    model: input.model,
    is_local: true,
    is_remote: false,
    supports_browser: true,
    supports_node: false,
    is_cached: is_loaded,
    is_loaded,
    file_sizes: null,
  };
};
