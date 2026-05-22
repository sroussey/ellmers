/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
  ModelRecord,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import type { IBackendsTransport, IRunningHandle } from "@workglow/ai/provider-utils";
import { LOCAL_LLAMACPP_SERVER } from "./common/LlamaCppServer_Constants";

export interface ILlamaCppServerProviderOptions {
  readonly transport: IBackendsTransport;
  readonly externalUrl?: string;
  /**
   * Default context length passed to the broker when launching a backend.
   * Picked per request; larger values trade RAM for prompt+output budget.
   * Defaults to 4096 if unset.
   */
  readonly defaultCtx?: number;
}

/**
 * OpenAI-compatible HTTP chat-completion provider that forwards requests to a
 * running llama-server instance.  If `externalUrl` is provided the server is
 * assumed to already be running; otherwise the provider acquires a handle via
 * `transport.ensureRunning` before each request and releases it afterwards.
 *
 * v1 scope: chat completion only. Other capabilities are not registered; the
 * provider serves only chat completion in v1.
 */
export class LlamaCppServerProvider extends AiProvider {
  readonly name = LOCAL_LLAMACPP_SERVER;
  readonly displayName = "Local llama-server (HTTP)";
  readonly isLocal = true;
  readonly supportsBrowser = false;

  constructor(options: ILlamaCppServerProviderOptions) {
    const runFns: readonly AiProviderRunFnRegistration<
      TextGenerationTaskInput,
      TextGenerationTaskOutput,
      ModelConfig
    >[] = [
      {
        serves: ["text.generation"] as readonly Capability[],
        runFn: createLlamaCppServerTextGenerationStream(options) as AiProviderRunFn<
          TextGenerationTaskInput,
          TextGenerationTaskOutput,
          ModelConfig
        >,
      },
    ];

    const previewTasks: Record<
      string,
      AiProviderPreviewRunFn<TextGenerationTaskInput, TextGenerationTaskOutput, ModelConfig>
    > = {};

    super(runFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return (model.capabilities as readonly Capability[] | undefined) ?? ["text.generation"];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat-completion run-fn
// ─────────────────────────────────────────────────────────────────────────────

interface UnifiedTextGenerationInput extends TextGenerationTaskInput {
  readonly messages?: readonly { readonly role: string; readonly content: string }[];
  readonly systemPrompt?: string;
}

/**
 * Build and stream a chat-completion request against a llama-server
 * `/v1/chat/completions` endpoint.
 *
 * Discriminates on `Array.isArray(input.messages) && input.messages.length > 0`
 * so {@link AiChatTask} (chat path) and {@link TextGenerationTask}
 * (prompt-only path) share the same registered run-fn, consistent with
 * the pattern used across workglow providers.
 */
function createLlamaCppServerTextGenerationStream(
  options: ILlamaCppServerProviderOptions
): AiProviderRunFn<TextGenerationTaskInput, TextGenerationTaskOutput, ModelConfig> {
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
      model: model?.model_id ?? "",
      messages,
      stream: true,
      ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.topP !== undefined ? { top_p: input.topP } : {}),
      ...(input.frequencyPenalty !== undefined
        ? { frequency_penalty: input.frequencyPenalty }
        : {}),
      ...(input.presencePenalty !== undefined ? { presence_penalty: input.presencePenalty } : {}),
    });

    // Acquire base URL — either from external override or via transport.
    let baseUrl: string;
    let handle: IRunningHandle | undefined;

    if (options.externalUrl) {
      baseUrl = options.externalUrl.replace(/\/$/, "");
    } else {
      if (!model?.model_id) {
        throw new Error("LlamaCppServerProvider: model.model_id is required to acquire a backend");
      }
      handle = await options.transport.ensureRunning({
        backend: "llamacpp-server",
        modelPath: model.model_id,
        opts: { ctx: options.defaultCtx ?? 4096 },
      });
      baseUrl = handle.url.replace(/\/$/, "");
    }

    try {
      signal?.throwIfAborted?.();

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "(no body)");
        throw new Error(
          `LlamaCppServerProvider: HTTP ${response.status} from /v1/chat/completions — ${text}`
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("LlamaCppServerProvider: response body is null");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        let sawDone = false;
        while (!sawDone) {
          signal?.throwIfAborted?.();
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              sawDone = true;
              await reader.cancel().catch(() => undefined);
              break;
            }
            if (!data) continue;

            let chunk: { choices?: { delta?: { content?: string } }[] };
            try {
              chunk = JSON.parse(data) as typeof chunk;
            } catch {
              continue;
            }

            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              emit({ type: "text-delta", port: "text", textDelta: delta });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      emit({ type: "finish", data: {} as TextGenerationTaskOutput });
    } finally {
      await handle?.release();
    }
  };
}
