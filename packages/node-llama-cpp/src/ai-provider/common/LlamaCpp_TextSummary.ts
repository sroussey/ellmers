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
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
  streamFromSession,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (!model) throw new Error("Model config is required for TextSummaryTask.");

  const { LlamaChatSession } = await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Summarizing text");
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
    systemPrompt: "Summarize the following text concisely, preserving the key points.",
  });
  try {
    const text = await session.prompt(input.text, {
      signal,
      ...llamaCppSeedPromptSpread(model.provider_config),
    });
    update_progress(100, "Summarization complete");
    return { text };
  } finally {
    session.dispose({ disposeSequence: false });
    sequence.dispose();
  }
};

export const LlamaCpp_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  if (!model) throw new Error("Model config is required for TextSummaryTask.");

  const { LlamaChatSession } = await loadSdk();

  const context = await getOrCreateTextContext(model);
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
    systemPrompt: "Summarize the following text concisely, preserving the key points.",
  });
  try {
    yield* streamFromSession<TextSummaryTaskOutput>((onTextChunk) => {
      return session.prompt(input.text, {
        signal,
        onTextChunk,
        ...llamaCppSeedPromptSpread(model.provider_config),
      });
    }, signal);
  } finally {
    session.dispose({ disposeSequence: false });
    sequence.dispose();
  }
};
