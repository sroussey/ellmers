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
import { getClient, getModelName } from "./HFI_Client";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

export const HFI_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  HfInferenceModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timerLabel = `hfi:TextEmbedding:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

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

    logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name, batch: true });
    emit({
      type: "finish",
      data: {
        vector: embeddings.map((embedding) => new Float32Array(embedding as unknown as number[])),
      },
    });
    return;
  }

  const embedding = await client.featureExtraction(
    {
      model: modelName,
      inputs: input.text,
    },
    { signal }
  );

  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  emit({
    type: "finish",
    data: { vector: new Float32Array(embedding as unknown as number[]) },
  });
};
