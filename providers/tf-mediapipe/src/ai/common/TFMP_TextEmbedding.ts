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
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksTextSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_TextEmbedding: AiProviderStreamFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextEmbeddingTaskOutput>> {
  const { TextEmbedder } = await loadTfmpTasksTextSDK();
  const textEmbedder = yield* bridgeProgress((cb) =>
    getModelTask(model!, {}, cb, signal, TextEmbedder)
  );

  if (Array.isArray(input.text)) {
    const embeddings = input.text.map((text) => {
      const result = textEmbedder.embed(text);

      if (!result.embeddings?.[0]?.floatEmbedding) {
        throw new PermanentJobError("Failed to generate embedding: Empty result");
      }

      return Float32Array.from(result.embeddings[0].floatEmbedding);
    });

    yield { type: "finish", data: { vector: embeddings } };
    return;
  }

  const result = textEmbedder.embed(input.text);

  if (!result.embeddings?.[0]?.floatEmbedding) {
    throw new PermanentJobError("Failed to generate embedding: Empty result");
  }

  const embedding = Float32Array.from(result.embeddings[0].floatEmbedding);

  yield { type: "finish", data: { vector: embedding } };
};
