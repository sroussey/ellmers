/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
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

export const WebBrowser_TextRewriter: AiProviderStreamFn<
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
