/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export function createOllamaTextRewriter(
  getClient: GetClient
): AiProviderRunFn<TextRewriterTaskInput, TextRewriterTaskOutput, OllamaModelConfig> {
  const run: AiProviderRunFn<
    TextRewriterTaskInput,
    TextRewriterTaskOutput,
    OllamaModelConfig
  > = async (input, model, update_progress, _signal) => {
    update_progress(0, "Starting Ollama text rewriting");
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const response = await client.chat({
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
        { role: "user", content: input.text },
      ],
    });

    update_progress(100, "Completed Ollama text rewriting");
    return { text: response.message.content };
  };
  return run;
}

export function createOllamaTextRewriterStream(
  getClient: GetClient
): AiProviderStreamFn<TextRewriterTaskInput, TextRewriterTaskOutput, OllamaModelConfig> {
  return async function* (
    input,
    model,
    signal
  ): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
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

    const onAbort = () => stream.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const chunk of stream) {
        const delta = chunk.message.content;
        if (delta) {
          yield { type: "text-delta", port: "text", textDelta: delta };
        }
      }
      yield { type: "finish", data: {} as TextRewriterTaskOutput };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}
