/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { getClient, getModelName, getProvider } from "./HFI_Client";

export const HFI_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting HF Inference text rewriting");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const response = await client.chatCompletion(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
        { role: "user", content: input.text },
      ],
      provider,
    },
    { signal }
  );

  update_progress(100, "Completed HF Inference text rewriting");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const HFI_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
        { role: "user", content: input.text },
      ],
      provider,
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
