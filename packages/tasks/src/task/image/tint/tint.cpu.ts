/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import {
  CpuImage,
  registerFilterOp,
  resolveColor,
  type ColorObject,
  type RawPixelBuffer,
} from "@workglow/util/media";

export interface TintParams {
  color: ColorObject | string;
  amount: number;
}

function cpuTint(
  bin: RawPixelBuffer,
  tr: number,
  tg: number,
  tb: number,
  amount: number
): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;
  const invAmount = 1 - amount;
  const tintR = tr * amount;
  const tintG = tg * amount;
  const tintB = tb * amount;
  const pixelCount = width * height;

  if (channels === 1) {
    const dst = new Uint8ClampedArray(pixelCount * 3);
    for (let i = 0; i < pixelCount; i++) {
      const gray = src[i]!;
      dst[i * 3] = gray * invAmount + tintR;
      dst[i * 3 + 1] = gray * invAmount + tintG;
      dst[i * 3 + 2] = gray * invAmount + tintB;
    }
    return { data: dst, width, height, channels: 3 };
  }

  const dst = new Uint8ClampedArray(src.length);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * channels;
    dst[idx] = src[idx]! * invAmount + tintR;
    dst[idx + 1] = src[idx + 1]! * invAmount + tintG;
    dst[idx + 2] = src[idx + 2]! * invAmount + tintB;
    if (channels === 4) {
      dst[idx + 3] = src[idx + 3]!;
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<TintParams>("cpu", "tint", (image, { color, amount }) => {
  const { r: tr, g: tg, b: tb } = resolveColor(color);
  return CpuImage.fromRaw(cpuTint((image as CpuImage).getBinary(), tr, tg, tb, amount));
});
