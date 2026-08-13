/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "@workglow/util/media";

registerFilterOp<undefined>("sharp", "grayscale", (image, _params) => {
  return (image as SharpImage).apply((p) => p.grayscale());
});
