/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { maybeEmitAnthropicRefusal } from "./Anthropic_Refusal";
import { applyAnthropicSamplingParams } from "./Anthropic_RequestParams";
import { buildAnthropicMessages } from "./Anthropic_ToolCalling";

/**
 * Inputs that the unified `["text.generation"]` runFn handles. Both
 * {@link TextGenerationTask} and {@link AiChatTask} declare
 * `requires: ["text.generation"]`, so the capability dispatcher routes both
 * here. AiChatTask supplies a populated `messages` array; TextGenerationTask
 * (and other simple prompt callers) supply a `prompt` string only.
 */
interface UnifiedTextGenerationInput extends TextGenerationTaskInput {
  readonly messages?: readonly unknown[];
  readonly systemPrompt?: string;
}

/**
 * Streaming run-fn for the `["text.generation"]` capability. Used by both
 * {@link TextGenerationTask} (prompt-only input) and {@link AiChatTask}
 * (full conversation history). Yields `text-delta` events on the `text` port
 * and a final empty `finish` event per the streaming convention (consumer
 * accumulates).
 *
 * Discriminates on `Array.isArray(input.messages) && input.messages.length > 0`
 * to choose the chat vs. prompt path — safe because AiChatTask always provides
 * `messages` and TextGenerationTask never does.
 */
export const Anthropic_TextGeneration_Stream: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  const sessionId = sessionContext?.sessionId;
  const logger = getLogger();
  const timerLabel = `anthropic:TextGeneration:${getModelName(model)}`;
  logger.time(timerLabel, { model: getModelName(model) });
  try {
    const client = await getClient(model);
    const modelName = getModelName(model);
    const unified = input as UnifiedTextGenerationInput;
    const hasMessages = Array.isArray(unified.messages) && unified.messages.length > 0;

    const messages = hasMessages
      ? buildAnthropicMessages(
          unified.messages as Parameters<typeof buildAnthropicMessages>[0],
          unified.prompt ?? ""
        )
      : [{ role: "user" as const, content: input.prompt }];

    const params: Record<string, unknown> = {
      model: modelName,
      messages,
      max_tokens: getMaxTokens(input, model),
    };
    applyAnthropicSamplingParams(params, input, model);

    if (unified.systemPrompt) {
      params.system = sessionId
        ? [
            {
              type: "text",
              text: unified.systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ]
        : unified.systemPrompt;
    }

    // Prompt caching: annotate the last user message block when sessionId is present.
    if (sessionId && hasMessages && Array.isArray(messages) && messages.length > 0) {
      const last = messages[messages.length - 1] as { content: unknown };
      if (Array.isArray(last.content) && last.content.length > 0) {
        const blocks = last.content as Array<Record<string, unknown>>;
        blocks[blocks.length - 1] = {
          ...blocks[blocks.length - 1],
          cache_control: { type: "ephemeral" },
        };
      }
    }

    const stream = (client.messages.stream as (p: unknown, o: unknown) => AsyncIterable<unknown>)(
      params,
      { signal }
    );

    for await (const event of stream) {
      const e = event as {
        type: string;
        delta?: { type?: string; text?: string };
      };
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
        emit({ type: "text-delta", port: "text", textDelta: e.delta.text ?? "" });
      }
      maybeEmitAnthropicRefusal(event, emit);
    }
    emit({ type: "finish", data: {} as TextGenerationTaskOutput });
  } finally {
    logger.timeEnd(timerLabel, { model: getModelName(model) });
  }
};
