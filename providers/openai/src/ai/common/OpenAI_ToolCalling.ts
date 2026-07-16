/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
} from "@workglow/ai";
import {
  accumulateOpenAIResponsesStream,
  buildResponsesInput,
  buildResponsesTools,
  mapResponsesToolChoice,
} from "@workglow/ai/provider-utils";
import { filterValidToolCalls, toOpenAIMessages } from "@workglow/ai/worker";
import { mergeOpenAICheckpointPrefix } from "./OpenAI_CacheCheckpoint";
import { finalizeResponsesRequest, getClient, getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/**
 * Streaming run-fn for `["text.generation", "tool-use"]`. Calls the OpenAI
 * Responses endpoint with `stream: true` and forwards delta events via
 * {@link accumulateOpenAIResponsesStream}, which emits `text-delta` and tool-call
 * `object-delta` events plus a final empty `finish`.
 *
 * Defence-in-depth: each tool-call `object-delta` is filtered against
 * `input.tools` so a hallucinated function name never reaches the consumer.
 */
export const OpenAI_ToolCalling_Stream: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OpenAiModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = buildResponsesTools(input.tools);
  // Checkpoint consumption: replay the prefix content ahead of the tail so the
  // request's literal prefix matches the warm-up and hits the automatic
  // server-side prompt cache.
  const merged = mergeOpenAICheckpointPrefix(sessionContext, input);
  const { input: responsesInput, instructions } = buildResponsesInput({
    messages: toOpenAIMessages(
      merged
        ? ({
            ...input,
            messages: merged.messages,
            systemPrompt: merged.systemPrompt,
            prompt: "",
          } as ToolCallingTaskInput)
        : input
    ),
  });
  const toolChoice = mapResponsesToolChoice(input.toolChoice);

  const params: Record<string, unknown> = {
    model: modelName,
    input: responsesInput,
    tools,
    tool_choice: toolChoice,
  };
  if (instructions !== undefined) params.instructions = instructions;
  if (input.maxTokens !== undefined) params.max_output_tokens = input.maxTokens;
  if (input.temperature !== undefined) params.temperature = input.temperature;
  finalizeResponsesRequest(model, params);

  const stream = await client.responses.create(
    { ...params, stream: true } as Parameters<typeof client.responses.create>[0],
    { signal }
  );

  await accumulateOpenAIResponsesStream<ToolCallingTaskOutput>(
    stream as AsyncIterable<unknown>,
    (event) => {
      if (event.type === "object-delta" && event.port === "toolCalls") {
        const validated = filterValidToolCalls(event.objectDelta as ToolCalls, input.tools);
        if (validated.length > 0) {
          emit({ type: "object-delta", port: "toolCalls", objectDelta: validated });
        }
        return;
      }
      emit(event);
    }
  );
  emit({ type: "finish", data: { text: "", toolCalls: [] } as ToolCallingTaskOutput });
};
