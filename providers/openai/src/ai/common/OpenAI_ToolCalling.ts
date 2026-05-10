/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { toOpenAIMessages } from "@workglow/ai/worker";
import type {
  AiProviderStreamFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import {
  accumulateOpenAIStream,
  buildOpenAITools,
  mapOpenAIToolChoice,
} from "@workglow/ai/provider-utils";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

/**
 * Streaming run-fn for `["text.generation", "tool-use"]`. Calls the OpenAI
 * chat-completions endpoint with `stream: true` and forwards delta events via
 * {@link accumulateOpenAIStream}, which yields `text-delta` and tool-call
 * `object-delta` events plus a final empty `finish`.
 */
export const OpenAI_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
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

  yield* accumulateOpenAIStream(stream);
};
