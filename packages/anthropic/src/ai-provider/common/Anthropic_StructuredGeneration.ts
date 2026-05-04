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
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";

export const Anthropic_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal, outputSchema) => {
  update_progress(0, "Starting Anthropic structured generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const response = await client.messages.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      tools: [
        {
          name: "structured_output",
          description: "Output structured data conforming to the schema",
          input_schema: schema as any,
        },
      ],
      tool_choice: { type: "tool" as const, name: "structured_output" },
      max_tokens: getMaxTokens(input, model),
    },
    { signal }
  );

  const toolBlock = response.content.find((b: any) => b.type === "tool_use") as any;
  const object = toolBlock?.input ?? {};

  update_progress(100, "Completed Anthropic structured generation");
  return { object };
};

export const Anthropic_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  AnthropicModelConfig
> = async function* (
  input,
  model,
  signal,
  outputSchema
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const stream = client.messages.stream(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      tools: [
        {
          name: "structured_output",
          description: "Output structured data conforming to the schema",
          input_schema: schema as any,
        },
      ],
      tool_choice: { type: "tool" as const, name: "structured_output" },
      max_tokens: getMaxTokens(input, model),
    },
    { signal }
  );

  let accumulatedJson = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      accumulatedJson += event.delta.partial_json;
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
