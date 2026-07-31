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
import { isStrictCompatibleSchema } from "@workglow/ai/provider-utils";
import { parsePartialJson } from "@workglow/util/worker";
import { getClient, getModelName } from "./DeepSeek_Client";
import type { DeepSeekModelConfig } from "./DeepSeek_ModelSchema";

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
      messages: [{ role: "user", content: input.prompt }],
      response_format: {
        type: "json_schema" as never,
        json_schema: {
          name: "structured_output",
          schema: schema,
          strict: isStrictCompatibleSchema(schema),
        },
      } as never,
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
