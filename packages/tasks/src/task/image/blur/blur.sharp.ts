/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "@workglow/util/media";
import type { BlurParams } from "./blur.cpu";

registerFilterOp<BlurParams>("sharp", "blur", (image, { radius }) => {
  return (image as SharpImage).apply((p) => p.blur(radius * 0.5));
});
