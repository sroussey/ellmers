/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";
import { createEstimatedOutputUsageReporter } from "@workglow/ai/provider-utils";
import { getClient, getModelName, getProvider } from "./HFI_Client";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

export const HFI_TextSummary_Stream: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfInferenceModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const provisionalUsage = createEstimatedOutputUsageReporter(emit);
  provisionalUsage.onPrompt(
    `Summarize the following text concisely.\n${typeof input.text === "string" ? input.text : ""}`
  );

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text },
      ],
      provider,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      provisionalUsage.onText(delta);
      emit({ type: "text-delta", port: "text", textDelta: delta });
    }
  }
  provisionalUsage.flush();
  emit({ type: "finish", data: {} as TextSummaryTaskOutput });
};
