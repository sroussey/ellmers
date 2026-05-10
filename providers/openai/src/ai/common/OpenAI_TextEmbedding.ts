/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderStreamFn, TextEmbeddingTaskInput, TextEmbeddingTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

/**
 * One-shot streaming run-fn for `["text.embedding"]`. Calls the OpenAI
 * embeddings endpoint and yields a single `finish` event carrying the vector
 * (or array of vectors when `input.text` is an array).
 */
export const OpenAI_TextEmbedding_Stream: AiProviderStreamFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  OpenAiModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextEmbeddingTaskOutput>> {
  const logger = getLogger();
  const timerLabel = `openai:TextEmbedding:${getModelName(model)}`;
  logger.time(timerLabel, { model: getModelName(model) });
  try {
    const client = await getClient(model);
    const modelName = getModelName(model);

    const response = await client.embeddings.create(
      {
        model: modelName,
        input: input.text,
      },
      { signal }
    );

    const result: TextEmbeddingTaskOutput = Array.isArray(input.text)
      ? ({
          vector: response.data.map(
            (item: { embedding: number[] }) => new Float32Array(item.embedding)
          ),
        } as unknown as TextEmbeddingTaskOutput)
      : ({ vector: new Float32Array(response.data[0].embedding) } as TextEmbeddingTaskOutput);

    yield { type: "finish", data: result };
  } finally {
    logger.timeEnd(timerLabel, { model: getModelName(model) });
  }
};
