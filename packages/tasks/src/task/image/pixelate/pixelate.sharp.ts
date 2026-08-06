/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "@workglow/util/media";
import type { PixelateParams } from "./pixelate.cpu";

registerFilterOp<PixelateParams>("sharp", "pixelate", (image, { blockSize }) => {
  const sharp = image as SharpImage;
  const downW = Math.max(1, Math.floor(sharp.width / blockSize));
  const downH = Math.max(1, Math.floor(sharp.height / blockSize));
  const outW = sharp.width;
  const outH = sharp.height;
  return sharp.apply((p) => {
    const down = p.resize(downW, downH, { kernel: "nearest" });
    return down.resize(outW, outH, { kernel: "nearest" });
  });
});
