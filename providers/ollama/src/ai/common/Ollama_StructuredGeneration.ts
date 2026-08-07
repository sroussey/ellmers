/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  Usage,
} from "@workglow/ai";
import { createPartialJsonStream } from "@workglow/util/worker";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";
import { mapOllamaUsage } from "./Ollama_Usage";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

/**
 * Streaming run-fn factory for the `["text.generation", "json-mode"]`
 * capability. Ollama constrains output by passing the JSON schema as the chat
 * API's `format` parameter. Emits `object-delta` events with progressively
 * parsed partial JSON on the `object` port.
 *
 * Per the structured-generation streaming-convention exception, the final
 * `finish` event MUST carry the parsed object in `finish.data.object`: it is the
 * definitive result the {@link StructuredGenerationTask} consumer validates
 * against the output schema.
 */
export function createOllamaStructuredGenerationStream(
  getClient: GetClient
): AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  OllamaModelConfig
> {
  return async (input, model, signal, emit, outputSchema) => {
    signal?.throwIfAborted?.();
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const schema = input.outputSchema ?? outputSchema;

    const stream = await client.chat({
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      format: schema,
      options: {
        temperature: input.temperature,
        num_predict: input.maxTokens,
      },
      stream: true,
    });

    const onAbort = (): void => stream.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const json = createPartialJsonStream();
    let usage: Usage | undefined;
    try {
      if (signal?.aborted) stream.abort();
      signal?.throwIfAborted?.();
      for await (const chunk of stream) {
        usage = mapOllamaUsage(chunk) ?? usage;
        const delta = chunk.message.content;
        if (delta) {
          const partial = json.push(delta);
          if (partial !== undefined) {
            emit({ type: "object-delta", port: "object", objectDelta: partial });
          }
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    emit({
      type: "finish",
      data: { object: json.finishObject() } as StructuredGenerationTaskOutput,
      usage,
    });
  };
}
