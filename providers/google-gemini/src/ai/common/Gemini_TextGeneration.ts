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
import { getLogger } from "@workglow/util/worker";
import { createGeminiClient, getModelName, resolveThinkingConfig } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { emitGeminiRefusal, geminiRefusalCategory } from "./Gemini_Refusal";
import { buildGeminiContents } from "./Gemini_ToolCalling";

interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/**
 * Maps the canonical sampling params onto Gemini's `generationConfig`, only
 * setting fields that are defined so callers that omit a param keep the
 * provider's default (matching the OpenAI/Anthropic adapters).
 */
function buildGenerationConfig(input: TextGenerationTaskInput): GeminiGenerationConfig {
  const config: GeminiGenerationConfig = {};
  if (input.maxTokens !== undefined) config.maxOutputTokens = input.maxTokens;
  if (input.temperature !== undefined) config.temperature = input.temperature;
  if (input.topP !== undefined) config.topP = input.topP;
  if (input.frequencyPenalty !== undefined) config.frequencyPenalty = input.frequencyPenalty;
  if (input.presencePenalty !== undefined) config.presencePenalty = input.presencePenalty;
  return config;
}

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
 * Streaming run-fn for the `["text.generation"]` capability. Used by both
 * {@link TextGenerationTask} (prompt-only input) and {@link AiChatTask}
 * (full conversation history). Yields `text-delta` events on the `text` port
 * and a final empty `finish` event per the streaming convention (consumer
 * accumulates).
 *
 * Discriminates on `Array.isArray(input.messages) && input.messages.length > 0`
 * to choose the chat vs. prompt path — safe because AiChatTask always provides
 * `messages` and TextGenerationTask never does.
 */
export const Gemini_TextGeneration_Stream: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timerLabel = `gemini:TextGeneration:${getModelName(model)}`;
  logger.time(timerLabel, { model: getModelName(model) });
  try {
    signal?.throwIfAborted?.();
    const unified = input as UnifiedTextGenerationInput;
    const hasMessages = Array.isArray(unified.messages) && unified.messages.length > 0;

    const ai = await createGeminiClient(model);

    const contents = hasMessages
      ? buildGeminiContents(
          unified.messages as Parameters<typeof buildGeminiContents>[0],
          unified.prompt ?? ""
        )
      : [{ role: "user", parts: [{ text: input.prompt }] }];

    // Thinking is opt-in here (no default budget); when a budget is configured,
    // the output cap is padded so reasoning can't starve the visible answer.
    const { thinkingConfig, maxOutputTokens } = resolveThinkingConfig(model, input.maxTokens);

    const result = await ai.models.generateContentStream({
      model: getModelName(model),
      contents,
      config: {
        abortSignal: signal ?? undefined,
        // Only the chat path carries a system prompt; the prompt path has none.
        systemInstruction: hasMessages ? unified.systemPrompt || undefined : undefined,
        ...buildGenerationConfig(input),
        // Override maxOutputTokens from buildGenerationConfig with the thinking-aware value.
        maxOutputTokens,
        thinkingConfig,
      },
    });

    let refusalCategory: string | undefined;
    for await (const chunk of result) {
      // `chunk.text` concatenates answer text and already skips thought parts.
      const text = chunk.text;
      if (text) {
        emit({ type: "text-delta", port: "text", textDelta: text });
      }
      refusalCategory = refusalCategory ?? geminiRefusalCategory(chunk);
    }
    emitGeminiRefusal(emit, refusalCategory);

    emit({ type: "finish", data: {} as TextGenerationTaskOutput });
  } finally {
    logger.timeEnd(timerLabel, { model: getModelName(model) });
  }
};
