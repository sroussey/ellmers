/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";

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
> = async (input, model, update_progress, signal) => {
  const factory = getApi(
    "Summarizer",
    (globalThis as any)?.ai?.summarizer ??
      (typeof Summarizer !== "undefined" ? Summarizer : undefined)
  );
  await ensureAvailable("Summarizer", factory);
  const config = getConfig(model);

  const summarizer = await factory.create({
    type: config.summary_type,
    length: config.summary_length,
    format: config.summary_format,
  });
  try {
    const text = await summarizer.summarize(input.text, { signal });
    update_progress(100, "Completed text summarization");
    return { text };
  } finally {
    summarizer.destroy();
  }
};

export const WebBrowser_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
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
    yield* snapshotStreamToTextDeltas<TextSummaryTaskOutput>(stream, "text", (text) => ({ text }));
  } finally {
    summarizer.destroy();
  }
};
