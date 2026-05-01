/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, resolveColor, type RawPixelBuffer } from "@workglow/util/media";

export interface BorderParams {
  borderWidth: number;
  color: string | { r: number; g: number; b: number; a?: number };
}

function cpuBorder(
  bin: RawPixelBuffer,
  borderWidth: number,
  color: string | { r: number; g: number; b: number; a?: number }
): RawPixelBuffer {
  const { data: src, width: srcW, height: srcH, channels: srcCh } = bin;
  const bw = borderWidth;
  const resolved = resolveColor(color);
  const outCh = 4;
  const dstW = srcW + bw * 2;
  const dstH = srcH + bw * 2;
  const dst = new Uint8ClampedArray(dstW * dstH * outCh);

  const r = resolved.r;
  const g = resolved.g;
  const b = resolved.b;
  const a = resolved.a;

  for (let i = 0; i < dst.length; i += outCh) {
    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    dst[i + 3] = a;
  }

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const srcIdx = (y * srcW + x) * srcCh;
      const dstIdx = ((y + bw) * dstW + (x + bw)) * outCh;
      dst[dstIdx] = src[srcIdx]!;
      dst[dstIdx + 1] = srcCh >= 3 ? src[srcIdx + 1]! : src[srcIdx]!;
      dst[dstIdx + 2] = srcCh >= 3 ? src[srcIdx + 2]! : src[srcIdx]!;
      dst[dstIdx + 3] = srcCh === 4 ? src[srcIdx + 3]! : 255;
    }
  }

  return { data: dst, width: dstW, height: dstH, channels: outCh };
}

registerFilterOp<BorderParams>("cpu", "border", (image, { borderWidth, color }) => {
  return CpuImage.fromRaw(cpuBorder((image as CpuImage).getBinary(), borderWidth, color));
});
