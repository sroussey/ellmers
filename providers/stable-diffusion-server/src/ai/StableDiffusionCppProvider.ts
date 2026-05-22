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
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  ModelConfig,
  ModelRecord,
} from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import type { IBackendsTransport, IRunningHandle } from "@workglow/ai/provider-utils";
import { pngBytesToImageValue } from "@workglow/ai/provider-utils";
import { LOCAL_STABLE_DIFFUSION_CPP } from "./common/StableDiffusionCpp_Constants";

/**
 * Endpoint variants for stable-diffusion.cpp HTTP servers. Default `/txt2img`
 * matches the conventional sd.cpp HTTP API; `/v1/images/generations` is used
 * by OpenAI-compatible builds. Configurable so callers can switch without
 * forking the provider while the Phase-8 integration spike is pending.
 */
export type StableDiffusionCppEndpoint = "/txt2img" | "/v1/images/generations";

export interface IStableDiffusionCppProviderOptions {
  readonly transport: IBackendsTransport;
  readonly externalUrl?: string;
  readonly endpoint?: StableDiffusionCppEndpoint;
}

/**
 * HTTP client for a local stable-diffusion.cpp server. If `externalUrl` is
 * provided the server is assumed to already be running; otherwise the provider
 * acquires a handle via `transport.ensureRunning` before each request and
 * releases it afterwards.
 *
 * v1 scope: text-to-image only. Other capabilities are not registered; the
 * provider serves only image generation in v1.
 */
export class StableDiffusionCppProvider extends AiProvider {
  readonly name = LOCAL_STABLE_DIFFUSION_CPP;
  readonly displayName = "Local stable-diffusion.cpp (HTTP)";
  readonly isLocal = true;
  readonly supportsBrowser = false;

  constructor(options: IStableDiffusionCppProviderOptions) {
    const runFns: readonly AiProviderRunFnRegistration<
      ImageGenerateTaskInput,
      ImageGenerateTaskOutput,
      ModelConfig
    >[] = [
      {
        serves: ["image.generation"] as readonly Capability[],
        runFn: createStableDiffusionCppImageGenerateRunFn(options) as AiProviderRunFn<
          ImageGenerateTaskInput,
          ImageGenerateTaskOutput,
          ModelConfig
        >,
      },
    ];

    const previewTasks: Record<
      string,
      AiProviderPreviewRunFn<ImageGenerateTaskInput, ImageGenerateTaskOutput, ModelConfig>
    > = {};

    super(runFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return (model.capabilities as readonly Capability[] | undefined) ?? ["image.generation"];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Image-generation run-fn
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-shot run-fn for text-to-image generation via stable-diffusion.cpp HTTP server.
 *
 * Endpoint is selected via {@link IStableDiffusionCppProviderOptions.endpoint}
 * (defaults to `/txt2img`). Request: `POST <endpoint>` with `{ "prompt": "..." }`.
 * Response: `{ "images": ["<base64-png>", ...] }` — the first image is used.
 */
function createStableDiffusionCppImageGenerateRunFn(
  options: IStableDiffusionCppProviderOptions
): AiProviderRunFn<ImageGenerateTaskInput, ImageGenerateTaskOutput, ModelConfig> {
  const endpoint = options.endpoint ?? "/txt2img";
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();

    const body = JSON.stringify({ prompt: input.prompt });

    // Acquire base URL — either from external override or via transport.
    let baseUrl: string;
    let handle: IRunningHandle | undefined;

    if (options.externalUrl) {
      baseUrl = options.externalUrl.replace(/\/$/, "");
    } else {
      if (!model?.model_id) {
        throw new Error(
          "StableDiffusionCppProvider: model.model_id is required to acquire a backend"
        );
      }
      handle = await options.transport.ensureRunning({
        backend: "stable-diffusion-server",
        modelPath: model.model_id,
        opts: {},
      });
      baseUrl = handle.url.replace(/\/$/, "");
    }

    try {
      signal?.throwIfAborted?.();

      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "(no body)");
        throw new Error(
          `StableDiffusionCppProvider: HTTP ${response.status} from ${endpoint} — ${text}`
        );
      }

      const json = (await response.json()) as { images?: string[] };
      const base64 = json.images?.[0];
      if (!base64) {
        throw new Error("StableDiffusionCppProvider: response contained no images");
      }

      // Decode base64 PNG bytes platform-neutrally and wrap in an ImageValue.
      // Avoids Node-only `Buffer.from(...)` so the provider stays runtime-agnostic.
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const image = await pngBytesToImageValue(bytes, "png");

      emit({ type: "snapshot", data: { image } });
      emit({ type: "finish", data: {} as ImageGenerateTaskOutput });
    } finally {
      await handle?.release();
    }
  };
}
