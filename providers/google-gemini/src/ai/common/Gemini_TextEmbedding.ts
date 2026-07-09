/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
} from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";
import { createGeminiClient, getModelName } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

export const Gemini_TextEmbedding_Stream: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timerLabel = `gemini:TextEmbedding:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });
  try {
    const ai = await createGeminiClient(model);
    const taskType = model?.provider_config?.embedding_task_type || "RETRIEVAL_DOCUMENT";

    if (Array.isArray(input.text)) {
      const result = await ai.models.embedContent({
        model: getModelName(model),
        contents: input.text,
        config: { taskType, abortSignal: signal ?? undefined },
      });
      emit({
        type: "finish",
        data: {
          vector: (result.embeddings ?? []).map((e) => new Float32Array(e.values ?? [])),
        },
      });
      return;
    }

    const result = await ai.models.embedContent({
      model: getModelName(model),
      contents: input.text as string,
      config: { taskType, abortSignal: signal ?? undefined },
    });

    emit({
      type: "finish",
      data: { vector: new Float32Array(result.embeddings?.[0]?.values ?? []) },
    });
  } finally {
    logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  }
};
