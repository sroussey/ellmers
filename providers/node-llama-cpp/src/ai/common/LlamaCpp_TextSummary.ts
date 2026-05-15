/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
  streamFromSession,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_TextSummary_Stream: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  LlamaCppModelConfig
> = async (input, model, signal, emit) => {
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
    for await (const e of streamFromSession<TextSummaryTaskOutput>((onTextChunk) => {
      return session.prompt(input.text, {
        signal,
        onTextChunk,
        ...llamaCppSeedPromptSpread(model.provider_config),
      });
    }, signal)) {
      emit(e);
    }
  } finally {
    try {
      await session.dispose({ disposeSequence: false });
    } catch {}
    try {
      await sequence.dispose();
    } catch {}
  }
};
