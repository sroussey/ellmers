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
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { maybeEmitAnthropicRefusal } from "./Anthropic_Refusal";
import { applyAnthropicThinkingParams } from "./Anthropic_Thinking";
import { createAnthropicUsageCollector } from "./Anthropic_Usage";

/**
 * Streaming run-fn for the `["text.generation", "json-mode"]` capability.
 *
 * Anthropic implements structured generation via tool-use under the hood:
 * a synthetic `structured_output` tool forces the model to emit JSON conforming
 * to the output schema. The `input_json_delta` stream events are fed to an
 * incremental parser and yielded as `object-delta` for consumers that want
 * progressive updates. The final `finish` event carries the parsed object in
 * `finish.data.object` per the streaming-convention exception for structured
 * generation: it is the definitive object `StructuredGenerationTask` validates
 * against the schema and retries on.
 */
export const Anthropic_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, signal, emit, outputSchema) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const params: Record<string, unknown> = {
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
  };
  applyAnthropicThinkingParams(params, model);

  const stream = client.messages.stream(params, { signal });

  const json = createPartialJsonStream();
  const usageCollector = createAnthropicUsageCollector();
  const snapshotUsage = createUsageSnapshotEmitter(emit);
  for await (const event of stream) {
    usageCollector.observe(event);
    snapshotUsage(usageCollector.result());
    maybeEmitAnthropicRefusal(event, emit);
    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      const partial = json.push(event.delta.partial_json);
      if (partial !== undefined) {
        emit({ type: "object-delta", port: "object", objectDelta: partial });
      }
    }
  }

  emit({
    type: "finish",
    data: { object: json.finishObject() } as StructuredGenerationTaskOutput,
    usage: usageCollector.result(),
  });
};
