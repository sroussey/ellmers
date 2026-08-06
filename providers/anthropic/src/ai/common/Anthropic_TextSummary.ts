/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { maybeEmitAnthropicRefusal } from "./Anthropic_Refusal";
import { createAnthropicUsageCollector } from "./Anthropic_Usage";

export const Anthropic_TextSummary_Stream: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  AnthropicModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      system: "Summarize the following text concisely.",
      messages: [{ role: "user", content: input.text }],
      max_tokens: getMaxTokens(input, model),
    },
    { signal }
  );

  const usageCollector = createAnthropicUsageCollector();
  for await (const event of stream) {
    usageCollector.observe(event);
    maybeEmitAnthropicRefusal(event, emit);
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      emit({ type: "text-delta", port: "text", textDelta: event.delta.text });
    }
  }
  emit({ type: "finish", data: {} as TextSummaryTaskOutput, usage: usageCollector.result() });
};
