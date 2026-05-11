/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getConfigKey,
  getLlamaCppSession,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
  setLlamaCppSession,
  streamFromSession,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  LlamaCppModelConfig
> = async function* (
  input,
  model,
  signal,
  _outputSchema,
  sessionId
): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  if (!model) throw new Error("Model config is required for TextGenerationTask.");

  const { LlamaChatSession } = await loadSdk();

  const cached = sessionId ? getLlamaCppSession(sessionId) : undefined;
  const context = cached ? undefined : await getOrCreateTextContext(model);
  const sequence = cached ? cached.sequence : context!.getSequence();
  const session =
    cached?.session ??
    new LlamaChatSession({
      contextSequence: sequence,
      ...llamaCppChatSessionConstructorSpread(model),
    });

  if (sessionId && !cached) {
    setLlamaCppSession(sessionId, {
      mode: "progressive",
      sequence,
      session,
      modelKey: getConfigKey(model),
    });
  }

  try {
    yield* streamFromSession<TextGenerationTaskOutput>((onTextChunk) => {
      return session.prompt(input.prompt, {
        signal,
        onTextChunk,
        ...llamaCppSeedPromptSpread(model.provider_config),
        ...(input.temperature !== undefined && { temperature: input.temperature }),
        ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
        ...(input.topP !== undefined && { topP: input.topP }),
      });
    }, signal);
  } finally {
    if (!sessionId) {
      try {
        await session.dispose({ disposeSequence: false });
      } catch {}
      try {
        await sequence.dispose();
      } catch {}
    }
  }
};
