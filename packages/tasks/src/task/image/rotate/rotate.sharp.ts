/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "@workglow/util/media";
import type { RotateParams } from "./rotate.cpu";

registerFilterOp<RotateParams>("sharp", "rotate", (image, { angle, background }) => {
  const sharp = image as SharpImage;
  const swap = angle === 90 || angle === 270;
  const outW = swap ? sharp.height : sharp.width;
  const outH = swap ? sharp.width : sharp.height;
  return sharp.apply((p) => p.rotate(angle, background ? { background } : undefined), {
    width: outW,
    height: outH,
  });
});
