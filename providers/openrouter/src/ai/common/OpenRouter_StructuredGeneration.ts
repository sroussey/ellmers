/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import { parsePartialJson } from "@workglow/util/worker";
import { getClient, getModelName } from "./OpenRouter_Client";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";
import { buildOpenRouterExtras } from "./OpenRouter_RequestParams";

/**
 * Streaming run-fn for `["text.generation", "json-mode"]`. Emits `object-delta`
 * partial-JSON snapshots on the `object` port and a `finish` carrying the parsed
 * final object.
 */
export const OpenRouter_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  OpenRouterModelConfig
> = async (input, model, signal, emit, outputSchema) => {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const schema = input.outputSchema ?? outputSchema;

  // With a schema, request strict json_schema mode; without one, fall back to
  // json_object so the request never carries an undefined schema (which the API
  // rejects).
  const responseFormat = schema
    ? {
        type: "json_schema" as never,
        json_schema: { name: "structured_output", schema: schema, strict: true },
      }
    : { type: "json_object" as never };

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      response_format: responseFormat as never,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
      ...buildOpenRouterExtras(model),
    },
    { signal }
  );

  let accumulatedJson = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      accumulatedJson += delta;
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
  emit({ type: "finish", data: { object: finalObject } as StructuredGenerationTaskOutput });
};
