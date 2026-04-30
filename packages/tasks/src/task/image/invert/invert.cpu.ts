/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, registerFilterOp, type RawPixelBuffer } from "@workglow/util/media";

function cpuInvert(bin: RawPixelBuffer): RawPixelBuffer {
  const { data: src, width, height, channels } = bin;
  const dst = new Uint8ClampedArray(src.length);

  if (channels === 4) {
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = 255 - src[i]!;
      dst[i + 1] = 255 - src[i + 1]!;
      dst[i + 2] = 255 - src[i + 2]!;
      dst[i + 3] = src[i + 3]!;
    }
  } else {
    for (let i = 0; i < src.length; i++) {
      dst[i] = 255 - src[i]!;
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<undefined>("cpu", "invert", (image, _params) => {
  return CpuImage.fromRaw(cpuInvert((image as CpuImage).getBinary()));
});
