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
  accumulateOpenAIStream,
  buildOpenAITools,
  mapOpenAIToolChoice,
} from "@workglow/ai/provider-utils";
import { filterValidToolCalls, toOpenAIMessages } from "@workglow/ai/worker";
import { getClient, getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/**
 * Streaming run-fn for `["text.generation", "tool-use"]`. Calls the OpenAI
 * chat-completions endpoint with `stream: true` and forwards delta events via
 * {@link accumulateOpenAIStream}, which emits `text-delta` and tool-call
 * `object-delta` events plus a final empty `finish`.
 *
 * Defence-in-depth: each tool-call `object-delta` is filtered against
 * `input.tools` so a hallucinated function name never reaches the consumer.
 */
export const OpenAI_ToolCalling_Stream: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OpenAiModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = buildOpenAITools(input.tools);
  const messages = toOpenAIMessages(input);
  const toolChoice = mapOpenAIToolChoice(input.toolChoice, true);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
      tools,
      tool_choice: toolChoice,
    },
    { signal }
  );

  for await (const event of accumulateOpenAIStream(stream)) {
    if (event.type === "object-delta" && event.port === "toolCalls") {
      const validated = filterValidToolCalls(event.objectDelta as ToolCalls, input.tools);
      if (validated.length > 0) {
        emit({ type: "object-delta", port: "toolCalls", objectDelta: validated });
      }
      continue;
    }
    emit(event);
  }
};
