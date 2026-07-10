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
        strict: true,
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
  for await (const event of stream as AsyncIterable<{ type?: string; delta?: string }>) {
    const delta = event.type === "response.output_text.delta" ? (event.delta ?? "") : "";
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
