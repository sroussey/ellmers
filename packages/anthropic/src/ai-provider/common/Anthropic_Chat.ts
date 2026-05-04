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
import type { StreamEvent } from "@workglow/task-graph";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";
import { buildAnthropicMessages } from "./Anthropic_ToolCalling";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

function buildParams(
  input: AiChatProviderInput,
  model: AnthropicModelConfig | undefined,
  sessionId: string | undefined
): Record<string, unknown> {
  const messages = buildAnthropicMessages(input.messages, input.prompt);
  const params: Record<string, unknown> = {
    model: getModelName(model),
    messages,
    max_tokens: getMaxTokens({ maxTokens: input.maxTokens } as any, model),
  };
  if (input.temperature !== undefined) params.temperature = input.temperature;
  if (input.systemPrompt) {
    params.system = sessionId
      ? [
          {
            type: "text",
            text: input.systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ]
      : input.systemPrompt;
  }
  if (sessionId && messages.length > 0) {
    const last = messages[messages.length - 1] as { content: unknown };
    if (Array.isArray(last.content) && last.content.length > 0) {
      const blocks = last.content as Array<Record<string, unknown>>;
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: { type: "ephemeral" },
      };
    }
  }
  return params;
}

export const Anthropic_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal, _outputSchema, sessionId) => {
  update_progress(0, "Anthropic chat turn");
  const client = await getClient(model);
  const params = buildParams(input, model, sessionId);
  const response = await (client.messages.create as any)(params, { signal });
  const text = ((response as any).content as Array<Record<string, unknown>>)
    .filter((b) => b.type === "text")
    .map((b) => b.text as string)
    .join("");
  update_progress(100, "Turn complete");
  return { text };
};

export const Anthropic_Chat_Stream: AiProviderStreamFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  AnthropicModelConfig
> = async function* (
  input,
  model,
  signal,
  _outputSchema,
  sessionId
): AsyncIterable<StreamEvent<AiChatProviderOutput>> {
  const client = await getClient(model);
  const params = buildParams(input, model, sessionId);
  const stream = (client.messages.stream as any)(params, { signal });
  for await (const event of stream) {
    const e = event as { type: string; delta?: { type?: string; text?: string } };
    if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
      yield { type: "text-delta", port: "text", textDelta: e.delta.text ?? "" };
    }
  }
  yield { type: "finish", data: {} as AiChatProviderOutput };
};
