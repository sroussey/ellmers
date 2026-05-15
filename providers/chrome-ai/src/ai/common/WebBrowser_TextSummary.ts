/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";

import {
  ensureAvailable,
  getApi,
  getConfig,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  WebBrowserModelConfig
> = async (input, model, signal, emit) => {
  const factory = getApi("Summarizer", typeof Summarizer !== "undefined" ? Summarizer : undefined);
  await ensureAvailable("Summarizer", factory);
  const config = getConfig(model);

  const summarizer = await factory.create({
    type: config.summary_type,
    length: config.summary_length,
    format: config.summary_format,
  });
  try {
    const stream = summarizer.summarizeStreaming(input.text, { signal });
    for await (const e of snapshotStreamToTextDeltas<TextSummaryTaskOutput>(
      stream,
      "text",
      (text) => ({ text })
    )) {
      emit(e);
    }
  } finally {
    summarizer.destroy();
  }
};
