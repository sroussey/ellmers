/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IBackendsTransport, IRunningHandle } from "@workglow/ai/provider-utils";
import { LLAMACPP_SERVER_DEFAULT_CTX } from "./LlamaCppServer_Constants";
import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";

/**
 * Provider-construction options shared across registrations.
 *
 * `transport` and `externalUrl` are both optional, but the resolver throws
 * at acquisition time if no URL source resolves for a given request.
 */
export interface ILlamaCppServerProviderOptions {
  readonly transport?: IBackendsTransport;
  readonly externalUrl?: string;
  /** Default context length forwarded to the broker. Falls back to {@link LLAMACPP_SERVER_DEFAULT_CTX}. */
  readonly defaultCtx?: number;
}

/** Resolved base URL plus a release callback (no-op for externalUrl paths). */
export interface IAcquiredBaseUrl {
  readonly baseUrl: string;
  readonly release: () => Promise<void>;
}

/**
 * Resolve a base URL for one request.
 *
 * Precedence:
 *   1. `model.provider_config.base_url`
 *   2. `opts.externalUrl`
 *   3. `opts.transport.ensureRunning({ ... })` — requires `provider_config.model_path`
 *
 * Throws with a clear message if none of the three resolves.
 */
export async function acquireBaseUrl(
  model: LlamaCppServerModelConfig | undefined,
  opts: ILlamaCppServerProviderOptions
): Promise<IAcquiredBaseUrl> {
  const modelBaseUrl = model?.provider_config?.base_url;
  if (typeof modelBaseUrl === "string" && modelBaseUrl.length > 0) {
    return { baseUrl: stripTrailingSlash(modelBaseUrl), release: noopRelease };
  }
  if (typeof opts.externalUrl === "string" && opts.externalUrl.length > 0) {
    return { baseUrl: stripTrailingSlash(opts.externalUrl), release: noopRelease };
  }
  if (opts.transport) {
    const modelPath = model?.provider_config?.model_path;
    if (typeof modelPath !== "string" || modelPath.length === 0) {
      throw new Error(
        "LlamaCppServer: transport-mode acquisition requires provider_config.model_path."
      );
    }
    const ctx =
      typeof model?.provider_config?.ctx === "number"
        ? model.provider_config.ctx
        : (opts.defaultCtx ?? LLAMACPP_SERVER_DEFAULT_CTX);
    const handle: IRunningHandle = await opts.transport.ensureRunning({
      backend: "llamacpp-server",
      modelPath,
      opts: { ctx },
    });
    return {
      baseUrl: stripTrailingSlash(handle.url),
      release: () => handle.release(),
    };
  }
  throw new Error(
    "LlamaCppServer: no base URL source — set provider_config.base_url, opts.externalUrl, or opts.transport."
  );
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

const noopRelease = async (): Promise<void> => {};

// ── SSE helper ─────────────────────────────────────────────────────────────

/** One parsed delta from an OpenAI-compatible `/v1/chat/completions` stream. */
export interface IChatCompletionDelta {
  readonly contentDelta?: string;
  readonly toolCallDeltas?: ReadonlyArray<{
    readonly index?: number;
    readonly id?: string;
    readonly type?: string;
    readonly function?: { readonly name?: string; readonly arguments?: string };
  }>;
  readonly done?: boolean;
  readonly finishReason?: string;
}

/**
 * Iterate over `data:` lines from an SSE response body, parsing each into
 * an {@link IChatCompletionDelta}. Yields `{ done: true }` on `data: [DONE]`.
 *
 * The caller passes the `AbortSignal` so per-line throws happen promptly.
 * Cancels the reader on abort and on `[DONE]`.
 */
export async function* readChatCompletionDeltas(
  response: Response,
  signal: AbortSignal | undefined
): AsyncGenerator<IChatCompletionDelta> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("LlamaCppServer: response body is null");
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
          yield { done: true };
          await reader.cancel().catch(() => undefined);
          break;
        }
        if (!data) continue;
        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: IChatCompletionDelta["toolCallDeltas"];
            };
            finish_reason?: string;
          }>;
        };
        try {
          chunk = JSON.parse(data) as typeof chunk;
        } catch {
          continue;
        }
        const choice = chunk.choices?.[0];
        const contentDelta = choice?.delta?.content;
        const toolCallDeltas = choice?.delta?.tool_calls;
        const finishReason = choice?.finish_reason;
        if (contentDelta !== undefined || toolCallDeltas !== undefined || finishReason) {
          yield { contentDelta, toolCallDeltas, finishReason };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
