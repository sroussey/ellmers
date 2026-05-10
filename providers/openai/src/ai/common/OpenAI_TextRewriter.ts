/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderStreamFn, TextRewriterTaskInput, TextRewriterTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

/**
 * Streaming run-fn for `["text.rewriter"]`. Yields `text-delta` events on
 * the `text` port and a final empty `finish` event.
 */
export const OpenAI_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
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
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};
