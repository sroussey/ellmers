/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextRewriterTaskInput, TextRewriterTaskOutput } from "@workglow/ai";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export function createOllamaTextRewriterStream(
  getClient: GetClient
): AiProviderRunFn<TextRewriterTaskInput, TextRewriterTaskOutput, OllamaModelConfig> {
  return async (input, model, signal, emit) => {
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const stream = await client.chat({
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
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
          emit({ type: "text-delta", port: "text", textDelta: delta });
        }
      }
      emit({ type: "finish", data: {} as TextRewriterTaskOutput });
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };
}
