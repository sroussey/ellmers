/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

function cpuGrayscale(bin: RawPixelBuffer): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;
  const pixelCount = width * height;
  const dst = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * channels;
    let g: number;
    if (channels === 1) {
      g = src[idx]!;
    } else {
      g = (src[idx]! * 77 + src[idx + 1]! * 150 + src[idx + 2]! * 29) >> 8;
    }
    const a = channels === 4 ? src[idx + 3]! : 255;
    const dstIdx = i * 4;
    dst[dstIdx] = g;
    dst[dstIdx + 1] = g;
    dst[dstIdx + 2] = g;
    dst[dstIdx + 3] = a;
  }

  return { data: dst, width, height, channels: 4 };
}

registerFilterOp<undefined>("cpu", "grayscale", (image, _params) => {
  return CpuImage.fromRaw(cpuGrayscale((image as CpuImage).getBinary()));
});
