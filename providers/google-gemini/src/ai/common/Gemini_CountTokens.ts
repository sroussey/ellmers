/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
} from "@workglow/ai";
import { createGeminiClient, getModelName } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

export const Gemini_CountTokens_Stream: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, model, _signal, emit) => {
  const ai = await createGeminiClient(model);
  const result = await ai.models.countTokens({
    model: getModelName(model),
    contents: input.text,
  });
  emit({ type: "finish", data: { count: result.totalTokens ?? 0 } });
};

export const Gemini_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, _model) => {
  return { count: Math.ceil(input.text.length / 4) };
};
