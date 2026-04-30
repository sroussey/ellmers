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
import type { ImageValue } from "@workglow/util/media";
import { getLogger, TypedArray } from "@workglow/util/worker";
import { imageValueToBlob } from "../../common/imageOutputHelpers";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image embedding using Hugging Face Transformers.
 */
export const HFT_ImageEmbedding: AiProviderRunFn<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const timerLabel = `hft:ImageEmbedding:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  const embedder: ImageFeatureExtractionPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );

  logger.debug("HFT ImageEmbedding: pipeline ready, generating embedding", {
    model: model?.provider_config.model_path,
  });

  if (Array.isArray(input.image)) {
    const vectors: TypedArray[] = [];
    for (const image of input.image) {
      const imageArg = await imageValueToBlob(image as unknown as ImageValue);
      const result = await embedder(imageArg);
      vectors.push(result.data as TypedArray);
    }
    logger.timeEnd(timerLabel, { count: vectors.length });
    return { vector: vectors } as ImageEmbeddingTaskOutput;
  }

  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await embedder(imageArg);

  logger.timeEnd(timerLabel, { dimensions: result?.data?.length });
  return {
    vector: result.data as TypedArray,
  } as ImageEmbeddingTaskOutput;
};
