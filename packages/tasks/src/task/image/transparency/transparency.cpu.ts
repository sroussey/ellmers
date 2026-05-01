/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface TransparencyParams {
  amount: number;
}

function cpuTransparency(bin: RawPixelBuffer, amount: number): RawPixelBuffer {
  const { data: src, width, height, channels: srcCh } = bin;
  const pixelCount = width * height;
  const dst = new Uint8ClampedArray(pixelCount * 4);
  const alphaScale = Math.round(amount * 255);

  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * srcCh;
    const dstIdx = i * 4;
    dst[dstIdx] = src[srcIdx]!;
    dst[dstIdx + 1] = srcCh >= 3 ? src[srcIdx + 1]! : src[srcIdx]!;
    dst[dstIdx + 2] = srcCh >= 3 ? src[srcIdx + 2]! : src[srcIdx]!;
    const srcAlpha = srcCh === 4 ? src[srcIdx + 3]! : 255;
    dst[dstIdx + 3] = (srcAlpha * alphaScale + 127) / 255;
  }

  return { data: dst, width: width, height: height, channels: 4 };
}

registerFilterOp<TransparencyParams>("cpu", "transparency", (image, { amount }) => {
  return CpuImage.fromRaw(cpuTransparency((image as CpuImage).getBinary(), amount));
});
