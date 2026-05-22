/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextRewriterTaskInput, TextRewriterTaskOutput } from "@workglow/ai";

import {
  createDownloadMonitor,
  ensureAvailable,
  getApi,
  getChromeGlobal,
  getConfig,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  WebBrowserModelConfig
> = async (input, model, signal, emit) => {
  const factory = getApi("Rewriter", getChromeGlobal<typeof Rewriter>("Rewriter"));
  await ensureAvailable("Rewriter", factory);
  const config = getConfig(model);

  const rewriter = await factory.create({
    signal,
    tone: config.rewriter_tone,
    length: config.rewriter_length,
    monitor: createDownloadMonitor(emit),
  });
  try {
    const stream = rewriter.rewriteStreaming(input.text, {
      signal,
      context: input.prompt,
    });
    for await (const e of snapshotStreamToTextDeltas<TextRewriterTaskOutput>(stream, "text")) {
      emit(e);
    }
  } finally {
    rewriter.destroy();
  }
};
