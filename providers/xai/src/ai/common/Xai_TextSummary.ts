/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  Usage,
} from "@workglow/ai";
import {
  createEstimatedOutputUsageReporter,
  mapOpenAIChatUsage,
  OPENAI_STREAM_USAGE_OPTIONS,
} from "@workglow/ai/provider-utils";
import { getClient, getModelName } from "./Xai_Client";
import type { XaiModelConfig } from "./Xai_ModelSchema";

/**
 * Streaming run-fn for `["text.summary"]`. Emits `text-delta` events on the
 * `text` port and a final empty `finish` event.
 */
export const Xai_TextSummary_Stream: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  XaiModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const provisionalUsage = createEstimatedOutputUsageReporter(emit);
  provisionalUsage.onPrompt(
    `Summarize the following text concisely.\n${typeof input.text === "string" ? input.text : ""}`
  );

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text },
      ],
      stream: true,
      ...OPENAI_STREAM_USAGE_OPTIONS,
    },
    { signal }
  );

  let usage: Usage | undefined;
  for await (const chunk of stream) {
    usage = mapOpenAIChatUsage(chunk.usage) ?? usage;
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      provisionalUsage.onText(delta);
      emit({ type: "text-delta", port: "text", textDelta: delta });
    }
    const refusalDelta = chunk.choices?.[0]?.delta?.refusal ?? "";
    if (refusalDelta) {
      emit({ type: "refusal", refusal: refusalDelta });
    }
  }
  provisionalUsage.flush();
  emit({ type: "finish", data: {} as TextSummaryTaskOutput, usage });
};
