/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "@workglow/util/media";
import type { CropParams } from "./crop.cpu";

registerFilterOp<CropParams>("sharp", "crop", (image, { left, top, width, height }) => {
  return (image as SharpImage).apply((p) => p.extract({ left, top, width, height }), {
    width,
    height,
  });
});
