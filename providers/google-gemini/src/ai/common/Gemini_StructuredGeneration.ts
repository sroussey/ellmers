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
import { createGeminiClient, getModelName, resolveThinkingConfig } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { emitGeminiRefusal, geminiRefusalCategory } from "./Gemini_Refusal";
import { sanitizeSchemaForGemini } from "./Gemini_Schema";
import { mapGeminiUsage } from "./Gemini_Usage";

/**
 * Default reasoning allowance (in tokens) for the model's internal "thinking"
 * pass on a structured-generation request when `provider_config.thinking_budget`
 * is unset. Thinking models (Gemini 2.5+/3.x) reason before emitting the answer;
 * the thinking budget is separate from `maxOutputTokens`, so a small output cap
 * (the caller's `maxTokens`) still leaves room for the JSON. Without an explicit
 * budget a thinking model could consume the whole allotment reasoning and return
 * an empty object.
 */
const DEFAULT_STRUCTURED_THINKING_BUDGET = 2048;

/**
 * Streaming run-fn for `["text.generation", "json-mode"]`. Gemini uses
 * `responseSchema` + `responseMimeType: "application/json"` to produce
 * structured output. Per the streaming convention exception for json-mode,
 * the `finish` event MUST include the parsed `object` so that
 * `StructuredGenerationTask` can read it without a JSON streaming parser.
 *
 * With `responseMimeType: "application/json"` the response payload is JSON only —
 * reasoning stays internal and never appears in the emitted parts — so the
 * streamed text can be accumulated directly.
 */
export const Gemini_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit, outputSchema) => {
  const ai = await createGeminiClient(model);

  const schema = input.outputSchema ?? outputSchema;
  const sanitizedSchema = sanitizeSchemaForGemini(schema as Record<string, unknown>);

  // Gemini counts thinking tokens against `maxOutputTokens`, so a caller's small
  // output cap (e.g. 100) would otherwise be consumed by reasoning and truncate
  // the JSON to nothing. resolveThinkingConfig adds the thinking allowance on top
  // of the caller's cap; the emitted JSON still respects maxTokens.
  const { thinkingConfig, maxOutputTokens } = resolveThinkingConfig(
    model,
    input.maxTokens,
    DEFAULT_STRUCTURED_THINKING_BUDGET
  );

  const result = await ai.models.generateContentStream({
    model: getModelName(model),
    contents: [{ role: "user", parts: [{ text: input.prompt as string }] }],
    config: {
      abortSignal: signal ?? undefined,
      responseMimeType: "application/json",
      responseSchema: sanitizedSchema as any,
      maxOutputTokens,
      temperature: input.temperature,
      thinkingConfig,
    },
  });

  let accumulatedJson = "";
  let refusalCategory: string | undefined;
  let lastUsageMetadata: unknown;
  for await (const chunk of result) {
    lastUsageMetadata = chunk.usageMetadata ?? lastUsageMetadata;
    // `chunk.text` concatenates the answer text (thought parts are excluded).
    const text = chunk.text;
    if (text) {
      accumulatedJson += text;
      const partial = parsePartialJson(accumulatedJson);
      if (partial !== undefined) {
        emit({ type: "object-delta", port: "object", objectDelta: partial });
      }
    }
    refusalCategory = refusalCategory ?? geminiRefusalCategory(chunk);
  }
  emitGeminiRefusal(emit, refusalCategory);

  let finalObject: Record<string, unknown>;
  try {
    finalObject = JSON.parse(accumulatedJson);
  } catch {
    finalObject = parsePartialJson(accumulatedJson) ?? {};
  }
  // json-mode finish exception: populate finish.data.object with parsed result.
  emit({
    type: "finish",
    data: { object: finalObject } as StructuredGenerationTaskOutput,
    usage: mapGeminiUsage(lastUsageMetadata),
  });
};
