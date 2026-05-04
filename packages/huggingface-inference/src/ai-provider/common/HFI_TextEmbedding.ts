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
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { getClient, getModelName } from "./HFI_Client";

export const HFI_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timerLabel = `hfi:TextEmbedding:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting HF Inference text embedding");
  const client = await getClient(model);
  const modelName = getModelName(model);

  if (Array.isArray(input.text)) {
    const embeddings = await Promise.all(
      input.text.map((text) =>
        client.featureExtraction(
          {
            model: modelName,
            inputs: text,
          },
          { signal }
        )
      )
    );

    update_progress(100, "Completed HF Inference text embedding");
    logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name, batch: true });
    return {
      vector: embeddings.map((embedding) => new Float32Array(embedding as unknown as number[])),
    };
  }

  const embedding = await client.featureExtraction(
    {
      model: modelName,
      inputs: input.text,
    },
    { signal }
  );

  update_progress(100, "Completed HF Inference text embedding");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { vector: new Float32Array(embedding as unknown as number[]) };
};
