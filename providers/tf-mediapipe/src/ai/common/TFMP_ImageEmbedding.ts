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
import { toTexImageSource } from "./TFMP_Image";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ImageEmbedding: AiProviderRunFn<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  TFMPModelConfig
> = async (input, model, signal, emit) => {
  const { ImageEmbedder } = await loadTfmpTasksVisionSDK();
  const imageEmbedder = await getModelTask(model!, {}, emit, signal, ImageEmbedder);

  if (Array.isArray(input.image)) {
    const vectors: Float32Array[] = [];
    for (const image of input.image) {
      const result = imageEmbedder.embed(toTexImageSource(image));
      if (!result.embeddings?.[0]?.floatEmbedding) {
        throw new PermanentJobError("Failed to generate embedding: Empty result");
      }
      vectors.push(Float32Array.from(result.embeddings[0].floatEmbedding));
    }
    emit({ type: "finish", data: { vector: vectors } as ImageEmbeddingTaskOutput });
    return;
  }

  const result = imageEmbedder.embed(toTexImageSource(input.image));

  if (!result.embeddings?.[0]?.floatEmbedding) {
    throw new PermanentJobError("Failed to generate embedding: Empty result");
  }

  const embedding = Float32Array.from(result.embeddings[0].floatEmbedding);

  emit({ type: "finish", data: { vector: embedding } as ImageEmbeddingTaskOutput });
};
