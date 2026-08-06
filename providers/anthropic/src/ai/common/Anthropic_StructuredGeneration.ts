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
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { maybeEmitAnthropicRefusal } from "./Anthropic_Refusal";
import { createAnthropicUsageCollector } from "./Anthropic_Usage";

/**
 * Streaming run-fn for the `["text.generation", "json-mode"]` capability.
 *
 * Anthropic implements structured generation via tool-use under the hood:
 * a synthetic `structured_output` tool forces the model to emit JSON conforming
 * to the output schema. We accumulate the `input_json_delta` stream events and
 * yield `object-delta` for consumers that want incremental updates. The final
 * `finish` event carries the parsed object in `finish.data.object` per the
 * documented streaming-convention exception for structured generation (CLAUDE.md
 * lines 201-205): the `StructuredGenerationTask` consumer reads the parsed
 * object from `finish.data` directly instead of accumulating deltas.
 */
export const Anthropic_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, signal, emit, outputSchema) => {
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
  const usageCollector = createAnthropicUsageCollector();
  for await (const event of stream) {
    usageCollector.observe(event);
    maybeEmitAnthropicRefusal(event, emit);
    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      accumulatedJson += event.delta.partial_json;
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
  // Exception: structured generation MUST populate finish.data.object so the
  // StructuredGenerationTask consumer can read the parsed object without a
  // JSON streaming parser. See CLAUDE.md streaming-convention-exception note.
  emit({
    type: "finish",
    data: { object: finalObject } as StructuredGenerationTaskOutput,
    usage: usageCollector.result(),
  });
};
