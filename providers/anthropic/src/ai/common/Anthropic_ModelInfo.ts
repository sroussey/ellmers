/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderStreamFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

export const Anthropic_ModelInfo_Stream: AiProviderStreamFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  AnthropicModelConfig
> = async function* (input): AsyncIterable<StreamEvent<ModelInfoTaskOutput>> {
  const result: ModelInfoTaskOutput = {
    model: input.model,
    is_local: false,
    is_remote: true,
    supports_browser: true,
    supports_node: true,
    is_cached: false,
    is_loaded: false,
    file_sizes: null,
  };
  yield { type: "finish", data: result };
};
