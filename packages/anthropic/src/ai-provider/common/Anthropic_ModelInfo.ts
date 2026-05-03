/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

export const Anthropic_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  AnthropicModelConfig
> = async (input) => {
  if (input.detail === "dimensions") {
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
