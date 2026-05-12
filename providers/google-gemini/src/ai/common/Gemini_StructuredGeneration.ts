/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import { parsePartialJson } from "@workglow/util/worker";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
import { sanitizeSchemaForGemini } from "./Gemini_Schema";

/**
 * Streaming run-fn for `["text.generation", "json-mode"]`. Gemini uses
 * `responseSchema` + `responseMimeType: "application/json"` to produce
 * structured output. Per the streaming convention exception for json-mode,
 * the `finish` event MUST include the parsed `object` so that
 * `StructuredGenerationTask` can read it without a JSON streaming parser.
 */
export const Gemini_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit, outputSchema) => {
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
        emit({ type: "object-delta", port: "object", objectDelta: partial });
      }
    }
  }

  let finalObject: Record<string, unknown>;
  try {
    finalObject = JSON.parse(accumulatedJson);
  } catch {
    finalObject = parsePartialJson(accumulatedJson) ?? {};
  }
  // json-mode finish exception: populate finish.data.object with parsed result.
  emit({ type: "finish", data: { object: finalObject } as StructuredGenerationTaskOutput });
};
