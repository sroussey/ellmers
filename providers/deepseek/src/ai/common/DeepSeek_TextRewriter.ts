/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextRewriterTaskInput, TextRewriterTaskOutput } from "@workglow/ai";
import { getClient, getModelName } from "./DeepSeek_Client";
import type { DeepSeekModelConfig } from "./DeepSeek_ModelSchema";

/**
 * Streaming run-fn for `["text.rewriter"]`. Emits `text-delta` events on the
 * `text` port and a final empty `finish` event.
 */
export const DeepSeek_TextRewriter_Stream: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  DeepSeekModelConfig
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
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      emit({ type: "text-delta", port: "text", textDelta: delta });
    }
    const refusalDelta = chunk.choices?.[0]?.delta?.refusal ?? "";
    if (refusalDelta) {
      emit({ type: "refusal", refusal: refusalDelta });
    }
  }
  emit({ type: "finish", data: {} as TextRewriterTaskOutput });
};
