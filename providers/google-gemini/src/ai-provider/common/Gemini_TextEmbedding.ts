/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskType } from "@google/generative-ai";
import type {
  AiProviderRunFn,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
} from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";

export const Gemini_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timerLabel = `gemini:TextEmbedding:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting Gemini text embedding");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const embeddingModel = genAI.getGenerativeModel({
    model: getModelName(model),
  });

  const taskType =
    (model?.provider_config?.embedding_task_type as TaskType) || ("RETRIEVAL_DOCUMENT" as TaskType);

  if (Array.isArray(input.text)) {
    const result = await embeddingModel.batchEmbedContents({
      requests: input.text.map((t) => ({
        content: { role: "user", parts: [{ text: t }] },
        taskType,
      })),
    });
    update_progress(100, "Completed Gemini text embedding");
    logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name, batch: true });
    return {
      vector: result.embeddings.map((e) => new Float32Array(e.values)),
    };
  }

  const result = await embeddingModel.embedContent({
    content: { role: "user", parts: [{ text: input.text as string }] },
    taskType,
  });

  update_progress(100, "Completed Gemini text embedding");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { vector: new Float32Array(result.embedding.values) };
};
