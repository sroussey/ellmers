/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
} from "@workglow/ai";
import { pngBytesToImageValue } from "@workglow/ai/provider-utils";
import {
  acquireBaseUrl,
  decodeBase64Png,
  type IStableDiffusionCppProviderOptions,
} from "./StableDiffusionCpp_Client";
import { STABLE_DIFFUSION_CPP_DEFAULT_ENDPOINT } from "./StableDiffusionCpp_Constants";
import type { StableDiffusionCppModelConfig } from "./StableDiffusionCpp_ModelSchema";
import { getStableDiffusionCppModelName } from "./StableDiffusionCpp_ModelUtil";

type AcquireFn = typeof acquireBaseUrl;

/**
 * One-shot run-fn for text -> image via stable-diffusion.cpp HTTP server.
 * Endpoint resolution: model.provider_config.endpoint > opts.endpoint >
 * STABLE_DIFFUSION_CPP_DEFAULT_ENDPOINT (`/txt2img`).
 *
 * Request: `POST <endpoint>` with `{ prompt, model?, ...optional params }`.
 * Response: `{ images: [base64Png, ...] }` — first image used.
 * Emits a `snapshot` with the decoded image, then `finish`.
 */
export function createStableDiffusionCppImageGenerateRunFn(
  opts: IStableDiffusionCppProviderOptions,
  acquire: AcquireFn = acquireBaseUrl
): AiProviderRunFn<ImageGenerateTaskInput, ImageGenerateTaskOutput, StableDiffusionCppModelConfig> {
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();

    const endpoint =
      model?.provider_config?.endpoint ?? opts.endpoint ?? STABLE_DIFFUSION_CPP_DEFAULT_ENDPOINT;
    const modelName = getStableDiffusionCppModelName(model);

    const body = JSON.stringify({
      prompt: input.prompt,
      ...(modelName ? { model: modelName } : {}),
    });

    const { baseUrl, release } = await acquire(model, opts);
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
          `StableDiffusionCpp: HTTP ${response.status} from ${endpoint} (image-generation) — ${text}`
        );
      }
      const json = (await response.json()) as { images?: string[] };
      const base64 = json.images?.[0];
      if (!base64) {
        throw new Error("StableDiffusionCpp: response contained no images");
      }
      const bytes = decodeBase64Png(base64);
      const image = await pngBytesToImageValue(bytes, "png");
      emit({ type: "snapshot", data: { image } });
      emit({ type: "finish", data: {} as ImageGenerateTaskOutput });
    } finally {
      await release();
    }
  };
}
