/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  Usage,
} from "@workglow/ai";
import { OPENAI_STREAM_USAGE_OPTIONS } from "@workglow/ai/provider-utils";
import { getClient, getModelName } from "./OpenRouter_Client";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";
import { buildOpenRouterExtras } from "./OpenRouter_RequestParams";
import { mapOpenRouterUsage } from "./OpenRouter_Usage";

/** Streaming run-fn for `["text.rewriter"]`. */
export const OpenRouter_TextRewriter_Stream: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  OpenRouterModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
        { role: "user", content: input.text },
      ],
      stream: true,
      ...buildOpenRouterExtras(model),
      ...OPENAI_STREAM_USAGE_OPTIONS,
    },
    { signal }
  );

  let usage: Usage | undefined;
  for await (const chunk of stream) {
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
  emit({ type: "finish", data: {} as TextRewriterTaskOutput, usage });
};
