/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  Usage,
} from "@workglow/ai";
import {
  firstNonStrictReason,
  isStrictCompatibleSchema,
  mapOpenAIResponsesUsage,
} from "@workglow/ai/provider-utils";
import { createPartialJsonStream } from "@workglow/util/worker";
import { finalizeResponsesRequest, getClient, getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { warnStrictDowngradedOnce } from "./OpenAI_ResponsesWarnings";

export { isStrictCompatibleSchema };

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

  const strict = isStrictCompatibleSchema(schema);
  if (!strict) {
    // Downshifted to strict:false; the request still succeeds but the
    // provider-side strict guarantee is off. Consumer re-validates.
    const reason = firstNonStrictReason(schema) ?? "unknown reason";
    warnStrictDowngradedOnce(modelName, reason);
  }

  const params: Record<string, unknown> = {
    model: modelName,
    input: input.prompt,
    text: {
      format: {
        type: "json_schema",
        name: "structured_output",
        schema: schema,
        strict,
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

  const json = createPartialJsonStream();
  let refusal = "";
  let usage: Usage | undefined;
  for await (const event of stream as AsyncIterable<{
    type?: string;
    delta?: string;
    response?: { usage?: unknown };
  }>) {
    if (
      event.type === "response.completed" ||
      event.type === "response.incomplete" ||
      event.type === "response.failed"
    ) {
      usage = mapOpenAIResponsesUsage(event.response?.usage) ?? usage;
    } else if (event.type === "response.output_text.delta") {
      const delta = event.delta ?? "";
      if (delta) {
        const partial = json.push(delta);
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

  emit({
    type: "finish",
    data: { object: json.finishObject() } as StructuredGenerationTaskOutput,
    usage,
  });
};
