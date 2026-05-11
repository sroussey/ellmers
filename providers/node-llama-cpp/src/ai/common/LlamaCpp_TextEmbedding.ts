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
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getOrCreateEmbeddingContext } from "./LlamaCpp_Runtime";

export const LlamaCpp_TextEmbedding: AiProviderStreamFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model): AsyncIterable<StreamEvent<TextEmbeddingTaskOutput>> {
  if (!model) throw new Error("Model config is required for TextEmbeddingTask.");

  const context = await getOrCreateEmbeddingContext(model);

  const texts = Array.isArray(input.text) ? input.text : [input.text];

  const embeddings = await Promise.all(
    texts.map((text) => context.getEmbeddingFor(text).then((e) => new Float32Array(e.vector)))
  );

  if (Array.isArray(input.text)) {
    yield { type: "finish", data: { vector: embeddings } };
    return;
  }
  yield { type: "finish", data: { vector: embeddings[0] } };
};
