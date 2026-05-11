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
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
  streamFromSession,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  if (!model) throw new Error("Model config is required for TextRewriterTask.");

  const { LlamaChatSession } = await loadSdk();

  const context = await getOrCreateTextContext(model);
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
    systemPrompt: input.prompt,
  });
  try {
    yield* streamFromSession<TextRewriterTaskOutput>((onTextChunk) => {
      return session.prompt(input.text, {
        signal,
        onTextChunk,
        ...llamaCppSeedPromptSpread(model.provider_config),
      });
    }, signal);
  } finally {
    try {
      await session.dispose({ disposeSequence: false });
    } catch {}
    try {
      await sequence.dispose();
    } catch {}
  }
};
