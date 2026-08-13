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
import { createUsageSnapshotEmitter } from "@workglow/ai/provider-utils";
import { createPartialJsonStream } from "@workglow/util/worker";
import {
  createGeminiClient,
  getGeminiSeed,
  getModelName,
  resolveThinkingConfig,
} from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { emitGeminiRefusal, geminiRefusalCategory } from "./Gemini_Refusal";
import { sanitizeSchemaForGemini } from "./Gemini_Schema";
import { mapGeminiUsage } from "./Gemini_Usage";

/**
 * Streaming run-fn for `["text.generation", "json-mode"]`. Gemini uses
 * `responseSchema` + `responseMimeType: "application/json"` to produce
 * structured output. Per the streaming convention exception for json-mode,
 * the `finish` event MUST include the parsed `object` — it is the definitive
 * result `StructuredGenerationTask` validates against the schema.
 *
 * Thinking headroom is opt-in via `provider_config.thinking_budget` or
 * `model.effort` (see {@link resolveThinkingConfig}). Do not invent a default
 * thinking pad — callers set an adequate `maxTokens` for the JSON answer.
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

  // When a budget is set (native or via model.effort), resolveThinkingConfig pads
  // maxTokens so thinking + JSON both fit; otherwise the caller's maxTokens passes through.
  const { thinkingConfig, maxOutputTokens } = resolveThinkingConfig(model, input.maxTokens);

  const result = await ai.models.generateContentStream({
    model: getModelName(model),
    contents: [{ role: "user", parts: [{ text: input.prompt as string }] }],
    config: {
      abortSignal: signal ?? undefined,
      responseMimeType: "application/json",
      responseSchema: sanitizedSchema as any,
      maxOutputTokens,
      temperature: input.temperature,
      seed: getGeminiSeed(model),
      thinkingConfig,
    },
  });

  const json = createPartialJsonStream();
  let refusalCategory: string | undefined;
  let lastUsageMetadata: unknown;
  const snapshotUsage = createUsageSnapshotEmitter(emit);
  for await (const chunk of result) {
    lastUsageMetadata = chunk.usageMetadata ?? lastUsageMetadata;
    snapshotUsage(mapGeminiUsage(lastUsageMetadata));
    // `chunk.text` concatenates the answer text (thought parts are excluded).
    const text = chunk.text;
    if (text) {
      const partial = json.push(text);
      if (partial !== undefined) {
        emit({ type: "object-delta", port: "object", objectDelta: partial });
      }
    }
    refusalCategory = refusalCategory ?? geminiRefusalCategory(chunk);
  }
  emitGeminiRefusal(emit, refusalCategory);

  // json-mode finish exception: populate finish.data.object with parsed result.
  emit({
    type: "finish",
    data: { object: json.finishObject() } as StructuredGenerationTaskOutput,
    usage: mapGeminiUsage(lastUsageMetadata),
  });
};
