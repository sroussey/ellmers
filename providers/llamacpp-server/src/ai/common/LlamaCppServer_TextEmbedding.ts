/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
} from "@workglow/ai";
import { acquireBaseUrl, type ILlamaCppServerProviderOptions } from "./LlamaCppServer_Client";
import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";
import { getLlamaCppServerModelName } from "./LlamaCppServer_ModelUtil";

type AcquireFn = typeof acquireBaseUrl;

/**
 * One-shot embedding run-fn. Per the project convention, the run-fn emits
 * a single `finish` event whose `data` is the full `TextEmbeddingTaskOutput`.
 */
export function createLlamaCppServerTextEmbeddingStream(
  opts: ILlamaCppServerProviderOptions,
  acquire: AcquireFn = acquireBaseUrl
): AiProviderRunFn<TextEmbeddingTaskInput, TextEmbeddingTaskOutput, LlamaCppServerModelConfig> {
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();
    const texts = Array.isArray(input.text) ? input.text : [input.text];
    const body = JSON.stringify({
      model: getLlamaCppServerModelName(model),
      input: texts,
    });
    const { baseUrl, release } = await acquire(model, opts);
    try {
      const response = await fetch(`${baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "(no body)");
        throw new Error(
          `LlamaCppServer: HTTP ${response.status} from /v1/embeddings (embeddings) — ${text}`
        );
      }
      const json = (await response.json()) as {
        data?: Array<{ embedding: number[] }>;
      };
      const vectors = (json.data ?? []).map((d) => new Float32Array(d.embedding));
      if (vectors.length !== texts.length) {
        throw new Error(
          `LlamaCppServer: /v1/embeddings returned ${vectors.length} embeddings for ${texts.length} input(s)`
        );
      }
      const data: TextEmbeddingTaskOutput = Array.isArray(input.text)
        ? { vector: vectors }
        : { vector: vectors[0] };
      emit({ type: "finish", data });
    } finally {
      await release();
    }
  };
}
