/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { getClient, getModelName } from "./HFI_Client";

export const HFI_TextEmbedding: AiProviderStreamFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  HfInferenceModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextEmbeddingTaskOutput>> {
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
    yield {
      type: "finish",
      data: {
        vector: embeddings.map((embedding) => new Float32Array(embedding as unknown as number[])),
      },
    };
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
  yield {
    type: "finish",
    data: { vector: new Float32Array(embedding as unknown as number[]) },
  };
};
