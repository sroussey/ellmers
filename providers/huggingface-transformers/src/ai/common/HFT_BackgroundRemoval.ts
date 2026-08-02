/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BackgroundRemovalPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
} from "@workglow/ai";
import {
  blobToImageValue,
  imageValueToBlob,
  pngBytesToImageValue,
} from "@workglow/ai/provider-utils";
import type { ImageValue } from "@workglow/util/media";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

/**
 * The subset of `RawImage` this module uses. Declared structurally rather than
 * as `RawImage` so the encoder probe stays independent of which methods a given
 * transformers.js version happens to ship.
 */
export interface EncodableRawImage {
  toBlob?: (type?: string, quality?: number) => Promise<Blob>;
  toSharp?: () => { png: () => { toBuffer: () => Promise<Uint8Array> } };
}

/**
 * Encode a pipeline's `RawImage` result as an {@link ImageValue}, preserving
 * the alpha channel background removal produces.
 *
 * `RawImage` exposes different encoders per runtime: `toBlob()` goes through a
 * canvas and is browser-only, `toSharp()` is node-only. Probe rather than
 * assume — this run-fn is registered for both the inline and worker runtimes.
 */
export async function rawImageToImageValue(image: EncodableRawImage): Promise<ImageValue> {
  if (typeof image.toBlob === "function") {
    return blobToImageValue(await image.toBlob("image/png"));
  }
  if (typeof image.toSharp === "function") {
    return pngBytesToImageValue(await image.toSharp().png().toBuffer(), "png");
  }

  throw new Error(
    "HFT_BackgroundRemoval: RawImage exposes neither toBlob() nor toSharp() in this transformers version"
  );
}

export const HFT_BackgroundRemoval: AiProviderRunFn<
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const remover = (await getPipeline(model!, emit, {}, signal)) as BackgroundRemovalPipeline;
    const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
    const result = await remover(imageArg);

    const resultImage = Array.isArray(result) ? result[0] : result;

    emit({
      type: "finish",
      data: {
        image: await rawImageToImageValue(resultImage),
      },
    });
  });
};
