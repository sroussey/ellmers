/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";
import { accumulateOpenAIResponsesStream } from "@workglow/ai/provider-utils";
import {
  getClient,
  getModelName,
  getReasoningConfig,
  resolvePromptCacheKey,
} from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/**
 * Streaming run-fn for `["text.summary"]`. Emits `text-delta` events on
 * the `text` port and a final empty `finish` event.
 */
export const OpenAI_TextSummary_Stream: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  OpenAiModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const reasoning = getReasoningConfig(model);

  const params: Record<string, unknown> = {
    model: getModelName(model),
    instructions: "Summarize the following text concisely.",
    input: input.text,
  };
  if (reasoning !== undefined) params.reasoning = reasoning;
  params.prompt_cache_key = resolvePromptCacheKey(model, params);

  const stream = await client.responses.create(
    { ...params, stream: true } as Parameters<typeof client.responses.create>[0],
    { signal }
  );

  await accumulateOpenAIResponsesStream(stream as AsyncIterable<unknown>, emit);
  emit({ type: "finish", data: {} as TextSummaryTaskOutput });
};
