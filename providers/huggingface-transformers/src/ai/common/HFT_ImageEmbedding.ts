/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageFeatureExtractionPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
} from "@workglow/ai";
import { imageValueToBlob } from "@workglow/ai/provider-utils";
import type { TypedArray } from "@workglow/util/worker";
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

export const HFT_ImageEmbedding: AiProviderRunFn<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timerLabel = `hft:ImageEmbedding:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const embedder = (await getPipeline(
      model!,
      emit,
      {},
      signal
    )) as ImageFeatureExtractionPipeline;

    logger.debug("HFT ImageEmbedding: pipeline ready, generating embedding", {
      model: model?.provider_config.model_path,
    });

    if (Array.isArray(input.image)) {
      const vectors: TypedArray[] = [];
      for (const image of input.image) {
        const imageArg = await imageValueToBlob(image);
        const result = await embedder(imageArg);
        vectors.push(result.data as TypedArray);
      }
      logger.timeEnd(timerLabel, { count: vectors.length });
      emit({ type: "finish", data: { vector: vectors } as ImageEmbeddingTaskOutput });
      return;
    }

    const imageArg = await imageValueToBlob(input.image);
    const result = await embedder(imageArg);

    logger.timeEnd(timerLabel, { dimensions: result?.data?.length });
    emit({
      type: "finish",
      data: { vector: result.data as TypedArray } as ImageEmbeddingTaskOutput,
    });
  });
};
