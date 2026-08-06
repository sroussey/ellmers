/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  Usage,
} from "@workglow/ai";
import { OPENAI_STREAM_USAGE_OPTIONS } from "@workglow/ai/provider-utils";
import { getLogger } from "@workglow/util/worker";
import { getClient, getModelName } from "./OpenRouter_Client";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";
import { buildChatParams, buildOpenRouterExtras } from "./OpenRouter_RequestParams";
import { mapOpenRouterUsage } from "./OpenRouter_Usage";

/**
 * Streaming run-fn for `["text.generation"]`. Serves both TextGenerationTask
 * (prompt) and AiChatTask (messages). Emits `text-delta` events and a final
 * empty `finish` per the streaming convention.
 */
export const OpenRouter_TextGeneration_Stream: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OpenRouterModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timerLabel = `openrouter:TextGeneration:${getModelName(model)}`;
  logger.time(timerLabel, { model: getModelName(model) });
  try {
    const client = await getClient(model);
    const params = { ...buildChatParams(input, model), ...buildOpenRouterExtras(model) };

    const stream = await client.chat.completions.create(
      { ...params, stream: true, ...OPENAI_STREAM_USAGE_OPTIONS } as Parameters<
        typeof client.chat.completions.create
      >[0],
      { signal }
    );

    let usage: Usage | undefined;
    for await (const chunk of stream as AsyncIterable<{
      choices?: Array<{ delta?: { content?: string | null; refusal?: string | null } }>;
      usage?: unknown;
    }>) {
      // The usage-bearing chunk arrives last with an empty `choices` array; the
      // delta reads below already tolerate that, so nothing else needs guarding.
      usage = mapOpenRouterUsage(chunk.usage) ?? usage;
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        emit({ type: "text-delta", port: "text", textDelta: delta });
      }
      const refusalDelta = chunk.choices?.[0]?.delta?.refusal ?? "";
      if (refusalDelta) {
        emit({ type: "refusal", refusal: refusalDelta });
      }
    }
    emit({ type: "finish", data: {} as TextGenerationTaskOutput, usage });
  } finally {
    logger.timeEnd(timerLabel, { model: getModelName(model) });
  }
};
