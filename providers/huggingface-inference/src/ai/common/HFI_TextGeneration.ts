/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import { toOpenAIMessages } from "@workglow/ai/worker";
import { getClient, getModelName, getProvider } from "./HFI_Client";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

/**
 * `TextGenerationTask` and `AiChatTask` share `requires: ["text.generation"]`,
 * so the dispatcher routes both here. AiChatTask supplies a populated
 * `messages` array; TextGenerationTask supplies only a `prompt` string.
 */
interface UnifiedTextGenerationInput extends TextGenerationTaskInput {
  readonly messages?: readonly unknown[];
  readonly systemPrompt?: string;
}

export const HFI_TextGeneration_Stream: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfInferenceModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  // Prefer a populated chat history (AiChatTask); fall back to wrapping
  // `prompt` as a single user turn (TextGenerationTask). Without this, chat
  // history routed to HFI was silently dropped.
  const unified = input as UnifiedTextGenerationInput;
  const hasMessages = Array.isArray(unified.messages) && unified.messages.length > 0;
  const messages = hasMessages
    ? toOpenAIMessages({
        messages: unified.messages,
        systemPrompt: unified.systemPrompt,
        prompt: "",
        tools: [],
      } as never)
    : [{ role: "user", content: input.prompt }];

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      provider,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      emit({ type: "text-delta", port: "text", textDelta: delta });
    }
  }
  emit({ type: "finish", data: {} as TextGenerationTaskOutput });
};
