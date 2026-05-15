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
import { getClient, getModelName, getProvider } from "./HFI_Client";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

export const HFI_TextGeneration_Stream: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfInferenceModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      provider,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      emit({ type: "text-delta", port: "text", textDelta: delta });
    }
  }
  emit({ type: "finish", data: {} as TextGenerationTaskOutput });
};
