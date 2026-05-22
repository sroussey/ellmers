/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
} from "@workglow/ai";
import { resolveWebBrowserApi } from "./WebBrowser_ApiBinding";
import { downloadWebBrowserModel } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_Download: AiProviderRunFn<
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
  WebBrowserModelConfig
> = async (input, model, signal, emit) => {
  if (!model) throw new Error("Model config is required for ModelDownloadTask.");
  const binding = resolveWebBrowserApi(model);
  await downloadWebBrowserModel(binding, signal, emit);
  emit({ type: "finish", data: { model: input.model! } });
};
