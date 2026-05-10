/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export function createOllamaTextSummaryStream(
  getClient: GetClient
): AiProviderStreamFn<TextSummaryTaskInput, TextSummaryTaskOutput, OllamaModelConfig> {
  return async function* (
    input,
    model,
    signal
  ): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const stream = await client.chat({
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text },
      ],
      stream: true,
    });

    const onAbort = (): void => stream.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const chunk of stream) {
        const delta = chunk.message.content;
        if (delta) {
          yield { type: "text-delta", port: "text", textDelta: delta };
        }
      }
      yield { type: "finish", data: {} as TextSummaryTaskOutput };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };
}
