/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export function createOllamaTextGeneration(
  getClient: GetClient
): AiProviderRunFn<TextGenerationTaskInput, TextGenerationTaskOutput, OllamaModelConfig> {
  const run: AiProviderRunFn<
    TextGenerationTaskInput,
    TextGenerationTaskOutput,
    OllamaModelConfig
  > = async (input, model, update_progress, signal) => {
    signal?.throwIfAborted?.();
    update_progress(0, "Starting Ollama text generation");
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const onAbort = () => client.abort?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      // Re-check after the listener is attached to close the
      // attach-vs-aborted race.
      signal?.throwIfAborted?.();
      const response = await client.chat({
        model: modelName,
        messages: [{ role: "user", content: input.prompt }],
        options: {
          temperature: input.temperature,
          top_p: input.topP,
          num_predict: input.maxTokens,
          frequency_penalty: input.frequencyPenalty,
          presence_penalty: input.presencePenalty,
        },
      });
      update_progress(100, "Completed Ollama text generation");
      return { text: response.message.content };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };
  return run;
}

export function createOllamaTextGenerationStream(
  getClient: GetClient
): AiProviderStreamFn<TextGenerationTaskInput, TextGenerationTaskOutput, OllamaModelConfig> {
  return async function* (
    input,
    model,
    signal
  ): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
    signal?.throwIfAborted?.();
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const stream = await client.chat({
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      options: {
        temperature: input.temperature,
        top_p: input.topP,
        num_predict: input.maxTokens,
        frequency_penalty: input.frequencyPenalty,
        presence_penalty: input.presencePenalty,
      },
      stream: true,
    });

    const onAbort = () => stream.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      // Re-check after the listener is attached to close the
      // attach-vs-aborted race.
      if (signal.aborted) stream.abort();
      for await (const chunk of stream) {
        const delta = chunk.message.content;
        if (delta) {
          yield { type: "text-delta", port: "text", textDelta: delta };
        }
      }
      yield { type: "finish", data: {} as TextGenerationTaskOutput };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}
