/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ImageEmbedding: AiProviderStreamFn<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<ImageEmbeddingTaskOutput>> {
  const { ImageEmbedder } = await loadTfmpTasksVisionSDK();
  const imageEmbedder = yield* bridgeProgress((cb) =>
    getModelTask(model!, {}, cb, signal, ImageEmbedder)
  );

  if (Array.isArray(input.image)) {
    const vectors: Float32Array[] = [];
    for (const image of input.image) {
      const result = imageEmbedder.embed(image as any);
      if (!result.embeddings?.[0]?.floatEmbedding) {
        throw new PermanentJobError("Failed to generate embedding: Empty result");
      }
      vectors.push(Float32Array.from(result.embeddings[0].floatEmbedding));
    }
    yield { type: "finish", data: { vector: vectors } as ImageEmbeddingTaskOutput };
    return;
  }

  const result = imageEmbedder.embed(input.image as any);

  if (!result.embeddings?.[0]?.floatEmbedding) {
    throw new PermanentJobError("Failed to generate embedding: Empty result");
  }

  const embedding = Float32Array.from(result.embeddings[0].floatEmbedding);

  yield { type: "finish", data: { vector: embedding } as ImageEmbeddingTaskOutput };
};
