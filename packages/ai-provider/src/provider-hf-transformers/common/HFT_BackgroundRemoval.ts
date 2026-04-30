/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BackgroundRemovalPipeline, RawImage } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
} from "@workglow/ai";
import type { ImageValue } from "@workglow/util/media";
import { dataUriToImageValue, imageValueToBlob } from "../../common/imageOutputHelpers";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

function rawImageToBase64Png(image: RawImage): string {
  const fn = (image as unknown as { toBase64?: () => string }).toBase64;
  if (typeof fn !== "function") {
    throw new Error("HFT_BackgroundRemoval: RawImage.toBase64 unavailable in this transformers version");
  }
  return fn.call(image);
}

/**
 * Core implementation for background removal using Hugging Face Transformers.
 */
export const HFT_BackgroundRemoval: AiProviderRunFn<
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const remover: BackgroundRemovalPipeline = await getPipeline(model!, onProgress, {}, signal);
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await remover(imageArg);

  const resultImage = Array.isArray(result) ? result[0] : result;
  const dataUri = `data:image/png;base64,${rawImageToBase64Png(resultImage)}`;

  return {
    image: await dataUriToImageValue(dataUri),
  };
};
