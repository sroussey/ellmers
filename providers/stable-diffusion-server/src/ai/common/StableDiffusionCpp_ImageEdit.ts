/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ImageEditTaskInput, ImageEditTaskOutput } from "@workglow/ai";
import { imageValueToPngBytes, pngBytesToImageValue } from "@workglow/ai/provider-utils";
import {
  acquireBaseUrl,
  buildServerUrl,
  decodeBase64Png,
  encodeBytesToBase64,
  type IStableDiffusionCppProviderOptions,
} from "./StableDiffusionCpp_Client";
import type { StableDiffusionCppModelConfig } from "./StableDiffusionCpp_ModelSchema";
import { getStableDiffusionCppModelName } from "./StableDiffusionCpp_ModelUtil";

type AcquireFn = typeof acquireBaseUrl;

/**
 * One-shot run-fn for image + prompt -> image (img2img) via stable-diffusion.cpp.
 *
 * Request: `POST /img2img` with `{ prompt, init_image: base64Png, model? }`.
 * Response: `{ images: [base64Png, ...] }` — first image used.
 * Emits `snapshot` then `finish`.
 *
 * Always uses `/img2img` — no OpenAI-compat alternative because
 * `/v1/images/edits` is multipart and sd.cpp doesn't speak that shape.
 */
export function createStableDiffusionCppImageEditRunFn(
  opts: IStableDiffusionCppProviderOptions,
  acquire: AcquireFn = acquireBaseUrl
): AiProviderRunFn<ImageEditTaskInput, ImageEditTaskOutput, StableDiffusionCppModelConfig> {
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();
    const modelName = getStableDiffusionCppModelName(model);

    const inputBytes = await imageValueToPngBytes(input.image);
    const initImageB64 = encodeBytesToBase64(inputBytes);

    const body = JSON.stringify({
      prompt: input.prompt,
      init_image: initImageB64,
      ...(modelName ? { model: modelName } : {}),
    });

    const { baseUrl, release } = await acquire(model, opts);
    try {
      signal?.throwIfAborted?.();
      const response = await fetch(buildServerUrl(baseUrl, "/img2img"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "(no body)");
        throw new Error(
          `StableDiffusionCpp: HTTP ${response.status} from /img2img (image-editing) — ${text}`
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
      emit({ type: "finish", data: {} as ImageEditTaskOutput });
    } finally {
      await release();
    }
  };
}
