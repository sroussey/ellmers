/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderStreamFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/** Known OpenAI embedding model dimensions. */
const OPENAI_EMBEDDING_DIMENSIONS: Record<string, { native_dimensions: number; mrl: boolean }> = {
  "text-embedding-3-small": { native_dimensions: 1536, mrl: true },
  "text-embedding-3-large": { native_dimensions: 3072, mrl: true },
  "text-embedding-ada-002": { native_dimensions: 1536, mrl: false },
};

/**
 * One-shot streaming run-fn for `["provider.model-info"]`. Returns a synchronous
 * info record from the in-process embedding-dimensions table; OpenAI does not
 * expose an HTTP endpoint for this metadata. Yields a single `finish` event.
 */
export const OpenAI_ModelInfo_Stream: AiProviderStreamFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  OpenAiModelConfig
> = async function* (input, model): AsyncIterable<StreamEvent<ModelInfoTaskOutput>> {
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
