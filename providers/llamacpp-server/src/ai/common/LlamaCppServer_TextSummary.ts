/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";
import {
  acquireBaseUrl,
  readChatCompletionDeltas,
  type ILlamaCppServerProviderOptions,
} from "./LlamaCppServer_Client";
import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";
import { getLlamaCppServerModelName } from "./LlamaCppServer_ModelUtil";

type AcquireFn = typeof acquireBaseUrl;

export function createLlamaCppServerTextSummaryStream(
  opts: ILlamaCppServerProviderOptions,
  acquire: AcquireFn = acquireBaseUrl
): AiProviderRunFn<TextSummaryTaskInput, TextSummaryTaskOutput, LlamaCppServerModelConfig> {
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();
    const body = JSON.stringify({
      model: getLlamaCppServerModelName(model),
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text },
      ],
      stream: true,
    });
    const { baseUrl, release } = await acquire(model, opts);
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "(no body)");
        throw new Error(
          `LlamaCppServer: HTTP ${response.status} from /v1/chat/completions (summary) — ${text}`
        );
      }
      for await (const delta of readChatCompletionDeltas(response, signal)) {
        if (delta.done) break;
        if (delta.contentDelta) {
          emit({ type: "text-delta", port: "text", textDelta: delta.contentDelta });
        }
      }
      emit({ type: "finish", data: {} as TextSummaryTaskOutput });
    } finally {
      await release();
    }
  };
}
