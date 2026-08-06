/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  Usage,
} from "@workglow/ai";
import {
  localOnlyFetch,
  mapOpenAIChatUsage,
  OPENAI_STREAM_USAGE_OPTIONS,
} from "@workglow/ai/provider-utils";
import {
  acquireBaseUrl,
  buildServerUrl,
  readChatCompletionDeltas,
  type ILlamaCppServerProviderOptions,
} from "./LlamaCppServer_Client";
import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";
import { getLlamaCppServerModelName } from "./LlamaCppServer_ModelUtil";

type AcquireFn = typeof acquireBaseUrl;

interface UnifiedTextGenerationInput extends TextGenerationTaskInput {
  readonly messages?: ReadonlyArray<{
    readonly role: string;
    readonly content:
      | string
      | ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "image_url"; readonly image_url: { readonly url: string } }
        >;
  }>;
  readonly systemPrompt?: string;
}

/**
 * Streaming run-fn factory for `["text.generation"]` (and, when the model has
 * `vision-input`, image-bearing chat content too).
 *
 * Discriminates on `Array.isArray(input.messages) && input.messages.length > 0`
 * so {@link AiChatTask} and {@link TextGenerationTask} share the same
 * registered run-fn, consistent with the project convention.
 *
 * Vision-input is folded into this run-fn rather than living separately:
 * llava-family chat is still a `/v1/chat/completions` call — only the
 * `content` shape changes. The provider's `inferCapabilities` decides
 * whether `vision-input` is declared.
 */
export function createLlamaCppServerTextGenerationStream(
  opts: ILlamaCppServerProviderOptions,
  acquire: AcquireFn = acquireBaseUrl
): AiProviderRunFn<TextGenerationTaskInput, TextGenerationTaskOutput, LlamaCppServerModelConfig> {
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();
    const unified = input as UnifiedTextGenerationInput;
    const hasMessages = Array.isArray(unified.messages) && unified.messages.length > 0;

    const messages = hasMessages
      ? [
          ...(unified.systemPrompt ? [{ role: "system", content: unified.systemPrompt }] : []),
          ...unified.messages!.map((m) => ({ role: m.role, content: m.content })),
        ]
      : [{ role: "user", content: input.prompt }];

    const body = JSON.stringify({
      model: getLlamaCppServerModelName(model),
      messages,
      stream: true,
      ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.topP !== undefined ? { top_p: input.topP } : {}),
      ...(input.frequencyPenalty !== undefined
        ? { frequency_penalty: input.frequencyPenalty }
        : {}),
      ...(input.presencePenalty !== undefined ? { presence_penalty: input.presencePenalty } : {}),
      ...OPENAI_STREAM_USAGE_OPTIONS,
    });

    const { baseUrl, release } = await acquire(model, opts);
    try {
      signal?.throwIfAborted?.();
      const response = await localOnlyFetch(
        buildServerUrl(baseUrl, "/v1/chat/completions"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal,
        },
        "LlamaCppServer"
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "(no body)");
        throw new Error(
          `LlamaCppServer: HTTP ${response.status} from /v1/chat/completions (text-generation) — ${text}`
        );
      }
      let usage: Usage | undefined;
      for await (const delta of readChatCompletionDeltas(response, signal)) {
        if (delta.done) break;
        usage = mapOpenAIChatUsage(delta.usage) ?? usage;
        if (delta.contentDelta) {
          emit({ type: "text-delta", port: "text", textDelta: delta.contentDelta });
        }
      }
      emit({ type: "finish", data: {} as TextGenerationTaskOutput, usage });
    } finally {
      await release();
    }
  };
}
