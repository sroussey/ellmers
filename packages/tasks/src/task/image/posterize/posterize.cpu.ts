/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface PosterizeParams {
  levels: number;
}

function cpuPosterize(bin: RawPixelBuffer, levels: number): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;

  const step = 255 / (levels - 1);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(Math.round(i / step) * step);
  }

  const dst = new Uint8ClampedArray(src.length);

  if (channels === 4) {
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = lut[src[i]!]!;
      dst[i + 1] = lut[src[i + 1]!]!;
      dst[i + 2] = lut[src[i + 2]!]!;
      dst[i + 3] = src[i + 3]!;
    }
  } else {
    for (let i = 0; i < src.length; i++) {
      dst[i] = lut[src[i]!]!;
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<PosterizeParams>("cpu", "posterize", (image, { levels }) => {
  return CpuImage.fromRaw(cpuPosterize((image as CpuImage).getBinary(), levels));
});
