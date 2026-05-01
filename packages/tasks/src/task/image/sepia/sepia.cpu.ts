/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

function cpuSepia(bin: RawPixelBuffer): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;
  const dst = new Uint8ClampedArray(src.length);
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * channels;
    const r = src[idx]!;
    const g = channels === 1 ? r : src[idx + 1]!;
    const b = channels === 1 ? r : src[idx + 2]!;

    const outR = (r * 402 + g * 787 + b * 194) >> 10;
    const outG = (r * 357 + g * 702 + b * 172) >> 10;
    const outB = (r * 279 + g * 547 + b * 134) >> 10;

    dst[idx] = outR > 255 ? 255 : outR;
    if (channels >= 3) {
      dst[idx + 1] = outG > 255 ? 255 : outG;
      dst[idx + 2] = outB > 255 ? 255 : outB;
    }
    if (channels === 4) {
      dst[idx + 3] = src[idx + 3]!;
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<undefined>("cpu", "sepia", (image, _params) => {
  return CpuImage.fromRaw(cpuSepia((image as CpuImage).getBinary()));
});
