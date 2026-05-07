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
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export function createOllamaTextEmbedding(
  getClient: GetClient
): AiProviderRunFn<TextEmbeddingTaskInput, TextEmbeddingTaskOutput, OllamaModelConfig> {
  return async (input, model, update_progress, _signal) => {
    update_progress(0, "Starting Ollama text embedding");
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const texts = Array.isArray(input.text) ? input.text : [input.text];

    const response = await client.embed({
      model: modelName,
      input: texts,
    });

    update_progress(100, "Completed Ollama text embedding");

    if (Array.isArray(input.text)) {
      return {
        vector: response.embeddings.map((e: number[]) => new Float32Array(e)),
      };
    }
    return { vector: new Float32Array(response.embeddings[0]) };
  };
}
