/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ImageEmbedding: AiProviderRunFn<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { ImageEmbedder } = await loadTfmpTasksVisionSDK();
  const imageEmbedder = await getModelTask(model!, {}, onProgress, signal, ImageEmbedder);

  if (Array.isArray(input.image)) {
    const vectors: Float32Array[] = [];
    for (const image of input.image) {
      const result = imageEmbedder.embed(image as any);
      if (!result.embeddings?.[0]?.floatEmbedding) {
        throw new PermanentJobError("Failed to generate embedding: Empty result");
      }
      vectors.push(Float32Array.from(result.embeddings[0].floatEmbedding));
    }
    return { vector: vectors } as ImageEmbeddingTaskOutput;
  }

  const result = imageEmbedder.embed(input.image as any);

  if (!result.embeddings?.[0]?.floatEmbedding) {
    throw new PermanentJobError("Failed to generate embedding: Empty result");
  }

  const embedding = Float32Array.from(result.embeddings[0].floatEmbedding);

  return {
    vector: embedding,
  } as ImageEmbeddingTaskOutput;
};
