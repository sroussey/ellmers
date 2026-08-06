/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "@workglow/util/media";
import type { ThresholdParams } from "./threshold.cpu";

registerFilterOp<ThresholdParams>("sharp", "threshold", (image, { value }) => {
  return (image as SharpImage).apply((p) => p.threshold(value));
});
