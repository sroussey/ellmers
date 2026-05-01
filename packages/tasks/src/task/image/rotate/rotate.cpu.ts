/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface RotateParams {
  angle: 90 | 180 | 270;
  background?: string;
}

function cpuRotate(bin: RawPixelBuffer, angle: 90 | 180 | 270): RawPixelBuffer {
  const { data: src, width: srcW, height: srcH, channels } = bin;

  const swap = angle === 90 || angle === 270;
  const dstW = swap ? srcH : srcW;
  const dstH = swap ? srcW : srcH;
  const dst = new Uint8ClampedArray(dstW * dstH * channels);

  for (let sy = 0; sy < srcH; sy++) {
    for (let sx = 0; sx < srcW; sx++) {
      let dx: number, dy: number;
      if (angle === 90) {
        dx = srcH - 1 - sy;
        dy = sx;
      } else if (angle === 180) {
        dx = srcW - 1 - sx;
        dy = srcH - 1 - sy;
      } else {
        dx = sy;
        dy = srcW - 1 - sx;
      }
      const srcIdx = (sy * srcW + sx) * channels;
      const dstIdx = (dy * dstW + dx) * channels;
      for (let c = 0; c < channels; c++) {
        dst[dstIdx + c] = src[srcIdx + c]!;
      }
    }
  }

  return { data: dst, width: dstW, height: dstH, channels };
}

registerFilterOp<RotateParams>("cpu", "rotate", (image, { angle }) => {
  return CpuImage.fromRaw(cpuRotate((image as CpuImage).getBinary(), angle));
});
