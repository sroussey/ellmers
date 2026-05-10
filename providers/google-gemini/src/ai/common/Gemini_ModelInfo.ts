/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderStreamFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

/** Known Gemini embedding model dimensions. */
const GEMINI_EMBEDDING_DIMENSIONS: Record<string, { native_dimensions: number; mrl: boolean }> = {
  "text-embedding-004": { native_dimensions: 768, mrl: true },
  "embedding-001": { native_dimensions: 768, mrl: false },
};

export const Gemini_ModelInfo_Stream: AiProviderStreamFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  GeminiModelConfig
> = async function* (input, model): AsyncIterable<StreamEvent<ModelInfoTaskOutput>> {
  if (input.detail === "dimensions") {
    const pc = model?.provider_config as Record<string, unknown>;
    let native_dimensions =
      typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
    let mrl = typeof pc?.mrl === "boolean" ? pc.mrl : undefined;
    if (native_dimensions === undefined) {
      const modelName = (pc?.model_name as string) ?? "";
      const known = GEMINI_EMBEDDING_DIMENSIONS[modelName];
      if (known) {
        native_dimensions = known.native_dimensions;
        mrl = mrl ?? known.mrl;
      }
    }
    yield {
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
        ...(native_dimensions !== undefined ? { native_dimensions } : {}),
        ...(mrl !== undefined ? { mrl } : {}),
      },
    };
    return;
  }
  yield {
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
  };
};
