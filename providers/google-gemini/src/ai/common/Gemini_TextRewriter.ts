/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";

export const Gemini_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
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
      yield { type: "text-delta", port: "text", textDelta: text };
    }
  }
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};
