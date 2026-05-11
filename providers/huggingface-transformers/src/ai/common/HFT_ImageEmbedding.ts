/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageFeatureExtractionPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { getLogger, TypedArray } from "@workglow/util/worker";
import { imageValueToBlob } from "@workglow/ai/provider-utils";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image embedding using Hugging Face Transformers.
 */
export const HFT_ImageEmbedding: AiProviderStreamFn<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ImageEmbeddingTaskOutput>> {
  const logger = getLogger();
  const timerLabel = `hft:ImageEmbedding:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  const embedder = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as ImageFeatureExtractionPipeline;

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
    yield { type: "finish", data: { vector: vectors } as ImageEmbeddingTaskOutput };
    return;
  }

  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await embedder(imageArg);

  logger.timeEnd(timerLabel, { dimensions: result?.data?.length });
  yield {
    type: "finish",
    data: { vector: result.data as TypedArray } as ImageEmbeddingTaskOutput,
  };
};
