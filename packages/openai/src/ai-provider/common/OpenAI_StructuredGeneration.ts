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
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

export const OpenAI_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal, outputSchema) => {
  update_progress(0, "Starting OpenAI structured generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      response_format: {
        type: "json_schema" as any,
        json_schema: {
          name: "structured_output",
          schema: schema,
          strict: true,
        },
      } as any,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
    },
    { signal }
  );

  const content = response.choices[0]?.message?.content ?? "{}";
  update_progress(100, "Completed OpenAI structured generation");
  return { object: JSON.parse(content) };
};

export const OpenAI_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  OpenAiModelConfig
> = async function* (
  input,
  model,
  signal,
  outputSchema
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      response_format: {
        type: "json_schema" as any,
        json_schema: {
          name: "structured_output",
          schema: schema,
          strict: true,
        },
      } as any,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
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
