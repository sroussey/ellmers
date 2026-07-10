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
import { finalizeResponsesRequest, getClient, getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/**
 * Whether a JSON schema satisfies the Responses `strict` subset — every object
 * has `additionalProperties: false` and lists all of its properties in
 * `required`, recursively. Combinators (`anyOf`/`oneOf`/`allOf`) and `$ref` are
 * treated conservatively as non-strict. When false we send `strict: false` so
 * the request isn't rejected with a 400; the `StructuredGenerationTask` consumer
 * still re-validates (and retries) the output against the original schema.
 */
export function isStrictCompatibleSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s.$ref !== undefined) return false;
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf) || Array.isArray(s.allOf)) return false;

  const isObject = s.type === "object" || (s.type === undefined && s.properties !== undefined);
  if (isObject) {
    if (s.additionalProperties !== false) return false;
    const props = (s.properties as Record<string, unknown> | undefined) ?? {};
    const required = Array.isArray(s.required) ? (s.required as string[]) : [];
    for (const key of Object.keys(props)) {
      if (!required.includes(key)) return false;
      if (!isStrictCompatibleSchema(props[key])) return false;
    }
    return true;
  }

  const isArray = s.type === "array" || s.items !== undefined;
  if (isArray) {
    if (Array.isArray(s.items)) return s.items.every(isStrictCompatibleSchema);
    return isStrictCompatibleSchema(s.items);
  }
  return true;
}

/**
 * Streaming run-fn for `["text.generation", "json-mode"]`. Emits
 * `object-delta` events with progressively-completed partial JSON snapshots
 * on the `object` port, ending with a `finish` event carrying the parsed
 * final object.
 */
export const OpenAI_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  OpenAiModelConfig
> = async (input, model, signal, emit, outputSchema) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const params: Record<string, unknown> = {
    model: modelName,
    input: input.prompt,
    text: {
      format: {
        type: "json_schema",
        name: "structured_output",
        schema: schema,
        strict: isStrictCompatibleSchema(schema),
      },
    },
  };
  if (input.maxTokens !== undefined) params.max_output_tokens = input.maxTokens;
  if (input.temperature !== undefined) params.temperature = input.temperature;
  finalizeResponsesRequest(model, params);

  const stream = await client.responses.create(
    { ...params, stream: true } as Parameters<typeof client.responses.create>[0],
    { signal }
  );

  let accumulatedJson = "";
  let refusal = "";
  for await (const event of stream as AsyncIterable<{ type?: string; delta?: string }>) {
    if (event.type === "response.output_text.delta") {
      const delta = event.delta ?? "";
      if (delta) {
        accumulatedJson += delta;
        const partial = parsePartialJson(accumulatedJson);
        if (partial !== undefined) {
          emit({ type: "object-delta", port: "object", objectDelta: partial });
        }
      }
    } else if (event.type === "response.refusal.delta") {
      refusal += event.delta ?? "";
    }
  }

  if (refusal) {
    // Surface the refusal as a first-class event; the consumer completes with
    // the reserved `refusal` field instead of retrying against empty JSON.
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
