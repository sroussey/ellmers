/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";

import {
  ensureAvailable,
  getApi,
  getConfig,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi("Rewriter", typeof Rewriter !== "undefined" ? Rewriter : undefined);
  await ensureAvailable("Rewriter", factory);
  const config = getConfig(model);

  const rewriter = await factory.create({
    tone: config.rewriter_tone,
    length: config.rewriter_length,
  });
  try {
    const text = await rewriter.rewrite(input.text, {
      signal,
      context: input.prompt,
    });
    update_progress(100, "Completed text rewriting");
    return { text };
  } finally {
    rewriter.destroy();
  }
};

export const WebBrowser_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const factory = getApi("Rewriter", typeof Rewriter !== "undefined" ? Rewriter : undefined);
  await ensureAvailable("Rewriter", factory);
  const config = getConfig(model);

  const rewriter = await factory.create({
    tone: config.rewriter_tone,
    length: config.rewriter_length,
  });
  try {
    const stream = rewriter.rewriteStreaming(input.text, {
      signal,
      context: input.prompt,
    });
    yield* snapshotStreamToTextDeltas<TextRewriterTaskOutput>(stream, "text", (text) => ({ text }));
  } finally {
    rewriter.destroy();
  }
};
