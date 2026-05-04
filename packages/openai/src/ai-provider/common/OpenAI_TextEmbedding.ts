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
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

export const OpenAI_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timerLabel = `openai:TextEmbedding:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting OpenAI text embedding");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.embeddings.create(
    {
      model: modelName,
      input: input.text,
    },
    { signal }
  );

  update_progress(100, "Completed OpenAI text embedding");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });

  if (Array.isArray(input.text)) {
    return {
      vector: response.data.map(
        (item: { embedding: number[] }) => new Float32Array(item.embedding)
      ),
    };
  }
  return { vector: new Float32Array(response.data[0].embedding) };
};
