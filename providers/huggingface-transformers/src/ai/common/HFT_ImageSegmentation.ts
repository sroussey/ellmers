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
import { imageValueFromBitmap, imageValueFromBuffer } from "@workglow/util/media";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

async function rawImageToImageValue(image: RawImage): Promise<ImageValue> {
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

  // HF Transformers runs in a Web Worker in the browser, where `Buffer` is
  // undefined. Branch on env: workers get a BrowserImageValue via
  // createImageBitmap(ImageData); node gets a NodeImageValue via Buffer.
  if (typeof Buffer === "undefined") {
    const data = new Uint8ClampedArray(
      rgba.buffer,
      rgba.byteOffset,
      rgba.byteLength
    ) as unknown as Uint8ClampedArray<ArrayBuffer>;
    const imageData = new ImageData(data, raw.width, raw.height);
    const bitmap = await createImageBitmap(imageData);
    return imageValueFromBitmap(bitmap, raw.width, raw.height);
  }
  return imageValueFromBuffer(Buffer.from(rgba), "raw-rgba", raw.width, raw.height);
}

export const HFT_ImageSegmentation: AiProviderRunFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const segmenter = (await getPipeline(model!, emit, {}, signal)) as ImageSegmentationPipeline;
    const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
    const result = await segmenter(imageArg, {
      threshold: input.threshold,
      mask_threshold: input.maskThreshold,
    });

    const masks = Array.isArray(result) ? result : [result];

    const processedMasks = await Promise.all(
      masks.map(async (mask) => ({
        label: mask.label || "",
        score: mask.score || 0,
        mask: await rawImageToImageValue(mask.mask),
      }))
    );

    emit({
      type: "finish",
      data: {
        masks: processedMasks,
      },
    });
  });
};
