/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextRewriterTaskInput, TextRewriterTaskOutput } from "@workglow/ai";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

export const Gemini_TextRewriter_Stream: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: input.prompt,
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.text }] }] },
    { signal }
  );

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      emit({ type: "text-delta", port: "text", textDelta: text });
    }
  }
  emit({ type: "finish", data: {} as TextRewriterTaskOutput });
};
