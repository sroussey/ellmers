/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { XaiModelConfig } from "./Xai_ModelSchema";

/**
 * One-shot run-fn for `["model.info"]`. Returns a synchronous info record; xAI
 * does not expose an HTTP endpoint for this metadata. Emits a single `finish`
 * event.
 */
export const Xai_ModelInfo_Stream: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  XaiModelConfig
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
