/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiChatProviderOutput,
  AiProviderRunFn,
  AiProviderStreamFn,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
import { buildGeminiContents } from "./Gemini_ToolCalling";

export const Gemini_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Gemini chat turn");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: input.systemPrompt || undefined,
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const contents = buildGeminiContents(input.messages, input.prompt);

  const result = await genModel.generateContent({ contents });
  const text = result.response.text() ?? "";
  update_progress(100, "Turn complete");
  return { text };
};

export const Gemini_Chat_Stream: AiProviderStreamFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<AiChatProviderOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: input.systemPrompt || undefined,
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const contents = buildGeminiContents(input.messages, input.prompt);

  const result = await genModel.generateContentStream({ contents }, { signal });

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield { type: "text-delta", port: "text", textDelta: text };
    }
  }
  yield { type: "finish", data: {} as AiChatProviderOutput };
};
