/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextGenerationTaskInput, TextGenerationTaskOutput } from "@workglow/ai";
import { toOpenAIMessages } from "@workglow/ai/worker";
import { getLogger } from "@workglow/util/worker";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

/**
 * Inputs that the unified `["text.generation"]` runFn handles. Both
 * {@link TextGenerationTask} and {@link AiChatTask} declare
 * `requires: ["text.generation"]`, so the capability dispatcher routes both
 * here. AiChatTask supplies a populated `messages` array; TextGenerationTask
 * (and other simple prompt callers) supply a `prompt` string only.
 */
interface UnifiedTextGenerationInput extends TextGenerationTaskInput {
  readonly messages?: readonly unknown[];
  readonly systemPrompt?: string;
}

/**
 * Build the OpenAI chat-completion request parameters from the unified input
 * shape — preferring a populated `messages` array (AiChatTask) and falling
 * back to wrapping `prompt` as a single user message (TextGenerationTask).
 */
function buildChatParams(
  input: UnifiedTextGenerationInput,
  model: OpenAiModelConfig | undefined
): Record<string, unknown> {
  const hasMessages = Array.isArray(input.messages) && input.messages.length > 0;
  const messages = hasMessages
    ? toOpenAIMessages({
        messages: input.messages,
        systemPrompt: input.systemPrompt,
        prompt: "",
        tools: [],
      } as never)
    : [{ role: "user" as const, content: input.prompt }];

  const params: Record<string, unknown> = {
    model: getModelName(model),
    messages,
  };
  if (input.maxTokens !== undefined) params.max_completion_tokens = input.maxTokens;
  if (input.temperature !== undefined) params.temperature = input.temperature;
  if ((input as { topP?: number }).topP !== undefined)
    params.top_p = (input as { topP?: number }).topP;
  if ((input as { frequencyPenalty?: number }).frequencyPenalty !== undefined)
    params.frequency_penalty = (input as { frequencyPenalty?: number }).frequencyPenalty;
  if ((input as { presencePenalty?: number }).presencePenalty !== undefined)
    params.presence_penalty = (input as { presencePenalty?: number }).presencePenalty;
  return params;
}

/**
 * Streaming run-fn for the `["text.generation"]` capability. Used by both
 * {@link TextGenerationTask} (prompt-only input) and {@link AiChatTask}
 * (full conversation history). Emits `text-delta` events on the `text` port
 * and a final empty `finish` event per the streaming convention (consumer
 * accumulates).
 */
export const OpenAI_TextGeneration_Stream: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OpenAiModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timerLabel = `openai:TextGeneration:${getModelName(model)}`;
  logger.time(timerLabel, { model: getModelName(model) });
  try {
    const client = await getClient(model);
    const params = buildChatParams(input as UnifiedTextGenerationInput, model);

    const stream = await client.chat.completions.create(
      { ...params, stream: true } as Parameters<typeof client.chat.completions.create>[0],
      { signal }
    );

    for await (const chunk of stream as AsyncIterable<{
      choices?: Array<{ delta?: { content?: string | null } }>;
    }>) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        emit({ type: "text-delta", port: "text", textDelta: delta });
      }
    }
    emit({ type: "finish", data: {} as TextGenerationTaskOutput });
  } finally {
    logger.timeEnd(timerLabel, { model: getModelName(model) });
  }
};
