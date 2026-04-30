/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { SharpImage, registerFilterOp, resolveColor } from "@workglow/util/media";
import type { TintParams } from "./tint.cpu";

// Sharp's built-in `.tint(rgb)` recomposes the channels via a fixed matrix and
// ignores any blend amount. The CPU arm (and the public TintParams contract)
// applies a linear blend: `out = src*(1-amount) + tint*amount` per channel.
// We mirror that with sharp's `.linear(a, b)` which evaluates `pixel*a + b`
// per channel — pass per-channel arrays so R/G/B each get the right offset.
registerFilterOp<TintParams>("sharp", "tint", (image, { color, amount }) => {
  const { r, g, b } = resolveColor(color);
  const a = 1 - amount;
  const offR = r * amount;
  const offG = g * amount;
  const offB = b * amount;
  return (image as SharpImage).apply((p) => p.linear([a, a, a], [offR, offG, offB]));
});
