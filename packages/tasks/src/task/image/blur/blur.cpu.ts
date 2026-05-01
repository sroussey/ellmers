/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

export interface BlurParams {
  radius: number;
}

function cpuBoxBlur(bin: RawPixelBuffer, radius: number): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;
  const kernelSize = radius * 2 + 1;

  const tmp = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < channels; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const x = Math.max(0, Math.min(k, width - 1));
        sum += src[(y * width + x) * channels + c]!;
      }
      tmp[y * width * channels + c] = (sum / kernelSize + 0.5) | 0;

      for (let x = 1; x < width; x++) {
        const addX = Math.min(x + radius, width - 1);
        const removeX = Math.max(x - radius - 1, 0);
        sum += src[(y * width + addX) * channels + c]! - src[(y * width + removeX) * channels + c]!;
        tmp[(y * width + x) * channels + c] = (sum / kernelSize + 0.5) | 0;
      }
    }
  }

  const dst = new Uint8ClampedArray(src.length);
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < channels; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const y = Math.max(0, Math.min(k, height - 1));
        sum += tmp[(y * width + x) * channels + c]!;
      }
      dst[x * channels + c] = (sum / kernelSize + 0.5) | 0;

      for (let y = 1; y < height; y++) {
        const addY = Math.min(y + radius, height - 1);
        const removeY = Math.max(y - radius - 1, 0);
        sum += tmp[(addY * width + x) * channels + c]! - tmp[(removeY * width + x) * channels + c]!;
        dst[(y * width + x) * channels + c] = (sum / kernelSize + 0.5) | 0;
      }
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<BlurParams>("cpu", "blur", (image, { radius }) => {
  return CpuImage.fromRaw(
    cpuBoxBlur((image as CpuImage).getBinary(), Math.max(1, radius | 0))
  );
});
