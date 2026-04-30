/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface FlipParams {
  direction: "horizontal" | "vertical";
}

function cpuFlip(bin: RawPixelBuffer, direction: "horizontal" | "vertical"): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;
  const dst = new Uint8ClampedArray(src.length);
  const rowBytes = width * channels;

  if (direction === "vertical") {
    for (let y = 0; y < height; y++) {
      const srcOffset = y * rowBytes;
      const dstOffset = (height - 1 - y) * rowBytes;
      dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * channels;
        const dstIdx = (y * width + (width - 1 - x)) * channels;
        for (let c = 0; c < channels; c++) {
          dst[dstIdx + c] = src[srcIdx + c]!;
        }
      }
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<FlipParams>("cpu", "flip", (image, { direction }) => {
  return CpuImage.fromRaw(cpuFlip((image as CpuImage).getBinary(), direction));
});
