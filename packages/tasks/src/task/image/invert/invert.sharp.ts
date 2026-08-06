/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "@workglow/util/media";

registerFilterOp<undefined>("sharp", "invert", (image, _params) => {
  return (image as SharpImage).apply((p) => p.negate({ alpha: false }));
});
