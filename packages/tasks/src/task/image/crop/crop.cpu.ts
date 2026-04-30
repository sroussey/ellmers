/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface CropParams {
  left: number;
  top: number;
  width: number;
  height: number;
}

function cpuCrop(
  bin: RawPixelBuffer,
  left: number,
  top: number,
  width: number,
  height: number
): RawPixelBuffer {
  const { data: src, width: srcW, height: srcH, channels } = bin;

  if (srcW < 1 || srcH < 1) {
    throw new RangeError("Cannot crop an empty image");
  }

  if (left < 0 || left >= srcW || top < 0 || top >= srcH) {
    throw new RangeError("Crop origin is outside the source image bounds");
  }

  const w = Math.min(width, srcW - left);
  const h = Math.min(height, srcH - top);

  const dst = new Uint8ClampedArray(w * h * channels);
  const rowBytes = w * channels;

  for (let row = 0; row < h; row++) {
    const srcOffset = ((top + row) * srcW + left) * channels;
    const dstOffset = row * rowBytes;
    dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
  }

  return { data: dst, width: w, height: h, channels };
}

registerFilterOp<CropParams>("cpu", "crop", (image, { left, top, width, height }) => {
  return CpuImage.fromRaw(
    cpuCrop((image as CpuImage).getBinary(), left, top, width, height)
  );
});
