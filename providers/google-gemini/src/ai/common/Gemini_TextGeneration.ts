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
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
import { buildGeminiContents } from "./Gemini_ToolCalling";

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

    const GoogleGenerativeAI = await loadGeminiSDK();
    const genAI = new GoogleGenerativeAI(getApiKey(model));

    if (hasMessages) {
      // Chat path — use buildGeminiContents to map the messages array.
      const genModel = genAI.getGenerativeModel({
        model: getModelName(model),
        systemInstruction: unified.systemPrompt || undefined,
        generationConfig: {
          maxOutputTokens: input.maxTokens,
          temperature: input.temperature,
        },
      });

      const contents = buildGeminiContents(
        unified.messages as Parameters<typeof buildGeminiContents>[0],
        unified.prompt ?? ""
      );

      const result = await genModel.generateContentStream({ contents }, { signal });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          emit({ type: "text-delta", port: "text", textDelta: text });
        }
      }
    } else {
      // Prompt path — simple single-user-message generation.
      const genModel = genAI.getGenerativeModel({
        model: getModelName(model),
        generationConfig: {
          maxOutputTokens: input.maxTokens,
          temperature: input.temperature,
          topP: input.topP,
        },
      });

      const result = await genModel.generateContentStream(
        { contents: [{ role: "user", parts: [{ text: input.prompt }] }] },
        { signal }
      );

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          emit({ type: "text-delta", port: "text", textDelta: text });
        }
      }
    }

    emit({ type: "finish", data: {} as TextGenerationTaskOutput });
  } finally {
    logger.timeEnd(timerLabel, { model: getModelName(model) });
  }
};
