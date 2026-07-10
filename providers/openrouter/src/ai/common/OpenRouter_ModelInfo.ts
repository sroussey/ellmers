/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";

/**
 * One-shot run-fn for `["model.info"]`. OpenRouter chat models are always
 * remote and cloud-hosted; emit a single `finish` with the standard remote
 * info record.
 */
export const OpenRouter_ModelInfo_Stream: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  OpenRouterModelConfig
> = async (input, _model, _signal, emit) => {
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
