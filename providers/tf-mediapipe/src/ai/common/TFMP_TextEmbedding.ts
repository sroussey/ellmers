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
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksTextSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { TextEmbedder } = await loadTfmpTasksTextSDK();
  const textEmbedder = await getModelTask(model!, {}, onProgress, signal, TextEmbedder);

  if (Array.isArray(input.text)) {
    const embeddings = input.text.map((text) => {
      const result = textEmbedder.embed(text);

      if (!result.embeddings?.[0]?.floatEmbedding) {
        throw new PermanentJobError("Failed to generate embedding: Empty result");
      }

      return Float32Array.from(result.embeddings[0].floatEmbedding);
    });

    return {
      vector: embeddings,
    };
  }

  const result = textEmbedder.embed(input.text);

  if (!result.embeddings?.[0]?.floatEmbedding) {
    throw new PermanentJobError("Failed to generate embedding: Empty result");
  }

  const embedding = Float32Array.from(result.embeddings[0].floatEmbedding);

  return {
    vector: embedding,
  };
};
