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

export interface IStableDiffusionCppProviderOptions {
  readonly transport: IBackendsTransport;
  readonly externalUrl?: string;
}

/**
 * HTTP client for a local stable-diffusion.cpp server. If `externalUrl` is
 * provided the server is assumed to already be running; otherwise the provider
 * acquires a handle via `transport.ensureRunning` before each request and
 * releases it afterwards.
 *
 * v1 scope: text-to-image only.  All other capabilities throw
 * "not implemented in v1" so the provider satisfies the `AiProvider` base
 * contract without dead code.
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
 * TODO(phase-8-spike): Verify the exact HTTP endpoint and request/response
 * shape against sd.cpp's actual HTTP server implementation. The sd.cpp HTTP
 * API is not formally documented — the endpoint below (`/txt2img`) is the
 * typical convention but must be confirmed in a Phase 8 integration spike.
 * An alternative OpenAI-compatible endpoint (`/v1/images/generations`) may
 * also be supported depending on the sd.cpp build.
 *
 * Expected request: `POST /txt2img` with `{ "prompt": "..." }`.
 * Expected response: `{ "images": ["<base64-png>", ...] }` — first image used.
 */
function createStableDiffusionCppImageGenerateRunFn(
  options: IStableDiffusionCppProviderOptions
): AiProviderRunFn<ImageGenerateTaskInput, ImageGenerateTaskOutput, ModelConfig> {
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
        backend: "stable-diffusion-cpp",
        modelPath: model.model_id,
        opts: {},
      });
      baseUrl = handle.url.replace(/\/$/, "");
    }

    try {
      signal?.throwIfAborted?.();

      // TODO(phase-8-spike): confirm endpoint — `/txt2img` is conventional for
      // sd.cpp; fall back to `/v1/images/generations` for OpenAI-compatible builds.
      const response = await fetch(`${baseUrl}/txt2img`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "(no body)");
        throw new Error(
          `StableDiffusionCppProvider: HTTP ${response.status} from /txt2img — ${text}`
        );
      }

      const json = (await response.json()) as { images?: string[] };
      const base64 = json.images?.[0];
      if (!base64) {
        throw new Error("StableDiffusionCppProvider: response contained no images");
      }

      // Decode base64 PNG bytes and wrap in a platform-appropriate ImageValue.
      const buffer = Buffer.from(base64, "base64");
      const image = await pngBytesToImageValue(
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
        "png"
      );

      emit({ type: "finish", data: { image } });
    } finally {
      await handle?.release();
    }
  };
}
