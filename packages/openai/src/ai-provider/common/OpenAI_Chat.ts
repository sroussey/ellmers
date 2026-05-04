/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiChatProviderOutput,
  AiProviderRunFn,
  AiProviderStreamFn,
} from "@workglow/ai";
import { toOpenAIMessages } from "@workglow/ai/worker";
import type { StreamEvent } from "@workglow/task-graph";
import { getClient, getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

function buildParams(
  input: AiChatProviderInput,
  model: OpenAiModelConfig | undefined
): Record<string, unknown> {
  // toOpenAIMessages accepts a ToolCallingTaskInput shape; synthesize one
  // with the fields it actually reads. Prompt is unused when messages present.
  const messages = toOpenAIMessages({
    messages: input.messages,
    systemPrompt: input.systemPrompt,
    prompt: "",
    tools: [],
  } as any);
  const params: Record<string, unknown> = {
    model: getModelName(model),
    messages,
  };
  if (input.temperature !== undefined) params.temperature = input.temperature;
  if (input.maxTokens !== undefined) params.max_completion_tokens = input.maxTokens;
  return params;
}

export const OpenAI_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "OpenAI chat turn");
  const client = await getClient(model);
  const response = await client.chat.completions.create(buildParams(input, model) as any, {
    signal,
  });
  const text = (response as any).choices?.[0]?.message?.content ?? "";
  update_progress(100, "Turn complete");
  return { text };
};

export const OpenAI_Chat_Stream: AiProviderStreamFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<AiChatProviderOutput>> {
  const client = await getClient(model);
  const stream = await client.chat.completions.create(
    { ...buildParams(input, model), stream: true } as any,
    { signal }
  );
  for await (const chunk of stream as any) {
    const delta = (chunk as any).choices?.[0]?.delta?.content as string | undefined;
    if (delta) yield { type: "text-delta", port: "text", textDelta: delta };
  }
  yield { type: "finish", data: {} as AiChatProviderOutput };
};
