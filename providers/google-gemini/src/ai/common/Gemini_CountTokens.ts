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
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";

export const Gemini_CountTokens_Stream: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({ model: getModelName(model) });
  const result = await genModel.countTokens(input.text);
  emit({ type: "finish", data: { count: result.totalTokens } });
};

export const Gemini_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, _model) => {
  return { count: Math.ceil(input.text.length / 4) };
};
