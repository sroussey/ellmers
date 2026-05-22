/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";

import {
  createDownloadMonitor,
  ensureAvailable,
  getApi,
  getChromeGlobal,
  getConfig,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  WebBrowserModelConfig
> = async (input, model, signal, emit) => {
  const factory = getApi("Summarizer", getChromeGlobal<typeof Summarizer>("Summarizer"));
  await ensureAvailable("Summarizer", factory);
  const config = getConfig(model);

  const summarizer = await factory.create({
    signal,
    type: config.summary_type,
    length: config.summary_length,
    format: config.summary_format,
    monitor: createDownloadMonitor(emit),
  });
  try {
    const stream = summarizer.summarizeStreaming(input.text, { signal });
    await snapshotStreamToTextDeltas<TextSummaryTaskOutput>(stream, "text", emit);
    emit({ type: "finish", data: {} as TextSummaryTaskOutput });
  } finally {
    summarizer.destroy();
  }
};
