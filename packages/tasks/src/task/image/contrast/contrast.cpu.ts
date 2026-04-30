/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface ContrastParams {
  amount: number;
}

function cpuContrast(bin: RawPixelBuffer, amount: number): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;

  const factor = (259 * (amount + 255)) / (255 * (259 - amount));
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = factor * (i - 128) + 128;
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

registerFilterOp<ContrastParams>("cpu", "contrast", (image, { amount }) => {
  return CpuImage.fromRaw(cpuContrast((image as CpuImage).getBinary(), amount));
});
