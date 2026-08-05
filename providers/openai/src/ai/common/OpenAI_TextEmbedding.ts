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
import { toUsageCount, usageOrUndefined } from "@workglow/ai/provider-utils";
import { getLogger } from "@workglow/util/worker";
import { getClient, getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/**
 * One-shot run-fn for `["text.embedding"]`. Calls the OpenAI
 * embeddings endpoint and emits a single `finish` event carrying the vector
 * (or array of vectors when `input.text` is an array).
 */
export const OpenAI_TextEmbedding_Stream: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  OpenAiModelConfig
> = async (input, model, signal, emit) => {
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

    // Embeddings bill only the prompt side; the endpoint reports no completion,
    // cache or reasoning counters, so those stay unreported rather than zeroed.
    const rawUsage = (response as { usage?: { prompt_tokens?: unknown; total_tokens?: unknown } })
      .usage;
    const usage = usageOrUndefined({
      input: toUsageCount(rawUsage?.prompt_tokens),
      output: undefined,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: toUsageCount(rawUsage?.total_tokens),
      extra: undefined,
    });

    emit({ type: "finish", data: result, usage });
  } finally {
    logger.timeEnd(timerLabel, { model: getModelName(model) });
  }
};
