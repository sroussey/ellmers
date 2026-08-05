/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextRewriterTaskInput, TextRewriterTaskOutput } from "@workglow/ai";
import { createGeminiClient, getModelName } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { emitGeminiRefusal, geminiRefusalCategory } from "./Gemini_Refusal";
import { mapGeminiUsage } from "./Gemini_Usage";

export const Gemini_TextRewriter_Stream: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const ai = await createGeminiClient(model);

  const result = await ai.models.generateContentStream({
    model: getModelName(model),
    contents: [{ role: "user", parts: [{ text: input.text }] }],
    config: {
      abortSignal: signal ?? undefined,
      systemInstruction: input.prompt,
    },
  });

  let refusalCategory: string | undefined;
  let lastUsageMetadata: unknown;
  for await (const chunk of result) {
    lastUsageMetadata = chunk.usageMetadata ?? lastUsageMetadata;
    const text = chunk.text;
    if (text) {
      emit({ type: "text-delta", port: "text", textDelta: text });
    }
    refusalCategory = refusalCategory ?? geminiRefusalCategory(chunk);
  }
  emitGeminiRefusal(emit, refusalCategory);
  emit({
    type: "finish",
    data: {} as TextRewriterTaskOutput,
    usage: mapGeminiUsage(lastUsageMetadata),
  });
};
