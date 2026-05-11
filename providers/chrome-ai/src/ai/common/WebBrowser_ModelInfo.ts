/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_ModelInfo: AiProviderStreamFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model): AsyncIterable<StreamEvent<ModelInfoTaskOutput>> {
  if (input.detail === "dimensions") {
    const pc = model?.provider_config as Record<string, unknown>;
    const native_dimensions =
      typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
    const mrl = typeof pc?.mrl === "boolean" ? pc.mrl : false;
    yield {
      type: "finish",
      data: {
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
      },
    };
    return;
  }
  yield {
    type: "finish",
    data: {
      model: input.model,
      is_local: true,
      is_remote: false,
      supports_browser: true,
      supports_node: false,
      is_cached: false,
      is_loaded: false,
      file_sizes: null,
    },
  };
};
