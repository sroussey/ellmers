/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageSegmentationPipeline, RawImage } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
} from "@workglow/ai";
import { imageValueToBlob } from "@workglow/ai/provider-utils";
import type { ImageValue } from "@workglow/util/media";
import { imageValueFromBuffer } from "@workglow/util/media";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

function rawImageToImageValue(image: RawImage): ImageValue {
  const raw = image as unknown as {
    readonly data: ArrayLike<number>;
    readonly width: number;
    readonly height: number;
    readonly channels: number;
  };
  const pixelCount = raw.width * raw.height;
  const rgba = new Uint8Array(pixelCount * 4);

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const sourceOffset = pixel * raw.channels;
    const targetOffset = pixel * 4;
    if (raw.channels === 1) {
      const value = raw.data[sourceOffset] ?? 0;
      rgba[targetOffset] = value;
      rgba[targetOffset + 1] = value;
      rgba[targetOffset + 2] = value;
      rgba[targetOffset + 3] = 255;
    } else {
      rgba[targetOffset] = raw.data[sourceOffset] ?? 0;
      rgba[targetOffset + 1] = raw.data[sourceOffset + 1] ?? raw.data[sourceOffset] ?? 0;
      rgba[targetOffset + 2] = raw.data[sourceOffset + 2] ?? raw.data[sourceOffset] ?? 0;
      rgba[targetOffset + 3] = raw.channels >= 4 ? (raw.data[sourceOffset + 3] ?? 255) : 255;
    }
  }

  return imageValueFromBuffer(Buffer.from(rgba), "raw-rgba", raw.width, raw.height);
}

/**
 * Core implementation for image segmentation using Hugging Face Transformers.
 */
export const HFT_ImageSegmentation: AiProviderRunFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  const segmenter = (await getPipeline(model!, emit, {}, signal)) as ImageSegmentationPipeline;
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await segmenter(imageArg, {
    threshold: input.threshold,
    mask_threshold: input.maskThreshold,
  });

  const masks = Array.isArray(result) ? result : [result];

  const processedMasks = masks.map((mask) => {
    return {
      label: mask.label || "",
      score: mask.score || 0,
      mask: rawImageToImageValue(mask.mask),
    };
  });

  emit({
    type: "finish",
    data: {
      masks: processedMasks,
    },
  });
};
