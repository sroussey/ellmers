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

export function createOllamaTextEmbeddingStream(
  getClient: GetClient
): AiProviderRunFn<TextEmbeddingTaskInput, TextEmbeddingTaskOutput, OllamaModelConfig> {
  return async (input, model, _signal, emit) => {
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const texts = Array.isArray(input.text) ? input.text : [input.text];

    const response = await client.embed({
      model: modelName,
      input: texts,
    });

    const data: TextEmbeddingTaskOutput = Array.isArray(input.text)
      ? { vector: response.embeddings.map((e: number[]) => new Float32Array(e)) }
      : { vector: new Float32Array(response.embeddings[0]) };

    emit({ type: "finish", data });
  };
}
