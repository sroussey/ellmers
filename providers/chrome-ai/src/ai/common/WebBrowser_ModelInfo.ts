/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { queryWebBrowserModelStatus } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

function baseModelInfo(
  input: ModelInfoTaskInput,
  is_cached: boolean,
  is_loaded: boolean,
  is_downloading?: boolean
): ModelInfoTaskOutput {
  return {
    model: input.model,
    is_local: true,
    is_remote: false,
    supports_browser: true,
    supports_node: false,
    is_cached,
    is_loaded,
    ...(is_downloading !== undefined ? { is_downloading } : {}),
    file_sizes: null,
  };
}

export const WebBrowser_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  WebBrowserModelConfig
> = async (input, model, _signal, emit) => {
  if (input.detail === "dimensions") {
    const pc = model?.provider_config as Record<string, unknown>;
    const native_dimensions =
      typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
    const mrl = typeof pc?.mrl === "boolean" ? pc.mrl : false;
    const { availability, is_cached, is_loaded } = await queryWebBrowserModelStatus(model);
    emit({
      type: "finish",
      data: {
        ...baseModelInfo(input, is_cached, is_loaded, availability === "downloading"),
        ...(native_dimensions !== undefined ? { native_dimensions } : {}),
        ...(mrl ? { mrl } : {}),
      },
    });
    return;
  }

  const { availability, is_cached, is_loaded } = await queryWebBrowserModelStatus(model);
  emit({
    type: "finish",
    data: baseModelInfo(input, is_cached, is_loaded, availability === "downloading"),
  });
};
