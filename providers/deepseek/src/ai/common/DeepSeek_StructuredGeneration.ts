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
import { getClient, getModelName } from "./DeepSeek_Client";
import type { DeepSeekModelConfig } from "./DeepSeek_ModelSchema";

/**
 * Build the user message for DeepSeek's JSON mode.
 *
 * DeepSeek supports only `response_format: { type: "json_object" }` — passing
 * OpenAI's `json_schema` form returns `400 This response_format type is
 * unavailable now`. That type does no schema enforcement, and the vendor
 * additionally requires the word "json" to appear in the prompt (otherwise the
 * request can come back with empty content). So the schema has to travel in the
 * prompt instead of in `response_format`, and the wording below deliberately
 * contains a lowercase "json" to satisfy that requirement.
 *
 * `StructuredGenerationTask` re-validates the parsed object against the output
 * schema, so a model that ignores the shape still fails loudly downstream
 * rather than silently returning the wrong thing.
 */
function buildJsonPrompt(prompt: string, schema: unknown): string {
  if (schema === undefined || schema === null) {
    return `${prompt}\n\nRespond with valid json only: a single JSON object, no prose and no code fences.`;
  }
  return (
    `${prompt}\n\nRespond with valid json only: a single JSON object conforming to this ` +
    `JSON Schema, with no prose and no code fences.\n\nJSON Schema:\n${JSON.stringify(schema)}`
  );
}

/**
 * Streaming run-fn for `["text.generation", "json-mode"]`. Emits
 * `object-delta` events with progressively-completed partial JSON snapshots
 * on the `object` port, ending with a `finish` event carrying the parsed
 * final object.
 */
export const DeepSeek_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  DeepSeekModelConfig
> = async (input, model, signal, emit, outputSchema) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: buildJsonPrompt(input.prompt, schema) }],
      response_format: { type: "json_object" } as never,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
    },
    { signal }
  );

  let accumulatedJson = "";
  let refusal = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      accumulatedJson += delta;
      const partial = parsePartialJson(accumulatedJson);
      if (partial !== undefined) {
        emit({ type: "object-delta", port: "object", objectDelta: partial });
      }
    }
    refusal += chunk.choices?.[0]?.delta?.refusal ?? "";
  }

  if (refusal) {
    emit({ type: "refusal", refusal });
  }

  let finalObject: Record<string, unknown>;
  try {
    finalObject = JSON.parse(accumulatedJson);
  } catch {
    finalObject = parsePartialJson(accumulatedJson) ?? {};
  }
  emit({ type: "finish", data: { object: finalObject } as StructuredGenerationTaskOutput });
};
