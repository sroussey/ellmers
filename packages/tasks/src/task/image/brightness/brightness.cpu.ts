/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface BrightnessParams {
  amount: number;
}

function cpuBrightness(bin: RawPixelBuffer, amount: number): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;
  const dst = new Uint8ClampedArray(src.length);

  if (channels === 4) {
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = src[i]! + amount;
      dst[i + 1] = src[i + 1]! + amount;
      dst[i + 2] = src[i + 2]! + amount;
      dst[i + 3] = src[i + 3]!;
    }
  } else {
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i]! + amount;
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<BrightnessParams>("cpu", "brightness", (image, { amount }) => {
  return CpuImage.fromRaw(cpuBrightness((image as CpuImage).getBinary(), amount));
});
