/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
import { sanitizeSchemaForGemini } from "./Gemini_Schema";

export const Gemini_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal, outputSchema) => {
  update_progress(0, "Starting Gemini structured generation");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));

  const schema = input.outputSchema ?? outputSchema;

  const sanitizedSchema = sanitizeSchemaForGemini(schema as Record<string, unknown>);

  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: sanitizedSchema as any,
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.prompt as string }] }],
  });

  const text = result.response.text();
  update_progress(100, "Completed Gemini structured generation");
  return { object: JSON.parse(text) };
};

export const Gemini_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  GeminiModelConfig
> = async function* (
  input,
  model,
  signal,
  outputSchema
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));

  const schema = input.outputSchema ?? outputSchema;

  const sanitizedSchema = sanitizeSchemaForGemini(schema as Record<string, unknown>);

  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: sanitizedSchema as any,
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.prompt as string }] }] },
    { signal }
  );

  let accumulatedJson = "";
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      accumulatedJson += text;
      const partial = parsePartialJson(accumulatedJson);
      if (partial !== undefined) {
        yield { type: "object-delta", port: "object", objectDelta: partial };
      }
    }
  }

  let finalObject: Record<string, unknown>;
  try {
    finalObject = JSON.parse(accumulatedJson);
  } catch {
    finalObject = parsePartialJson(accumulatedJson) ?? {};
  }
  yield { type: "finish", data: { object: finalObject } as StructuredGenerationTaskOutput };
};
