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
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export function createOllamaTextEmbeddingStream(
  getClient: GetClient
): AiProviderStreamFn<TextEmbeddingTaskInput, TextEmbeddingTaskOutput, OllamaModelConfig> {
  return async function* (input, model): AsyncIterable<StreamEvent<TextEmbeddingTaskOutput>> {
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

    yield { type: "finish", data };
  };
}
