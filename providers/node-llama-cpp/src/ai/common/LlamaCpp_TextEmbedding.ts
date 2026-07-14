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
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getActualModelPath,
  getOrCreateEmbeddingContext,
  withModelInUse,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  LlamaCppModelConfig
> = async (input, model, _signal, emit) => {
  if (!model) throw new Error("Model config is required for TextEmbeddingTask.");

  const modelPath = getActualModelPath(model);

  await withModelInUse(modelPath, async () => {
    const context = await getOrCreateEmbeddingContext(model);

    const texts = Array.isArray(input.text) ? input.text : [input.text];

    const embeddings = await Promise.all(
      texts.map((text) => context.getEmbeddingFor(text).then((e) => new Float32Array(e.vector)))
    );

    if (Array.isArray(input.text)) {
      emit({ type: "finish", data: { vector: embeddings } });
      return;
    }
    emit({ type: "finish", data: { vector: embeddings[0] } });
  });
};
