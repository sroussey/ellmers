/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface ThresholdParams {
  value: number;
}

function cpuThreshold(bin: RawPixelBuffer, value: number): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;
  const pixelCount = width * height;
  const dst = new Uint8ClampedArray(pixelCount * channels);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * channels;
    if (channels === 1) {
      dst[idx] = src[idx]! >= value ? 255 : 0;
    } else {
      dst[idx] = src[idx]! >= value ? 255 : 0;
      dst[idx + 1] = src[idx + 1]! >= value ? 255 : 0;
      dst[idx + 2] = src[idx + 2]! >= value ? 255 : 0;
      if (channels === 4) {
        dst[idx + 3] = src[idx + 3]!;
      }
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<ThresholdParams>("cpu", "threshold", (image, { value }) => {
  return CpuImage.fromRaw(cpuThreshold((image as CpuImage).getBinary(), value));
});
