/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

// Lean side-effect entry: registers the image raster codec AND every
// filter op available on this platform (cpu + sharp). Use this from
// tests and other contexts that need full filter dispatch but don't
// want the full @workglow/tasks barrel.
import "./task/image/registerImageRasterCodec.node";

// CPU arms — cross-platform.
import "./task/image/blur/blur.cpu";
import "./task/image/border/border.cpu";
import "./task/image/brightness/brightness.cpu";
import "./task/image/contrast/contrast.cpu";
import "./task/image/crop/crop.cpu";
import "./task/image/flip/flip.cpu";
import "./task/image/grayscale/grayscale.cpu";
import "./task/image/invert/invert.cpu";
import "./task/image/pixelate/pixelate.cpu";
import "./task/image/posterize/posterize.cpu";
import "./task/image/resize/resize.cpu";
import "./task/image/rotate/rotate.cpu";
import "./task/image/sepia/sepia.cpu";
import "./task/image/threshold/threshold.cpu";
import "./task/image/tint/tint.cpu";
import "./task/image/transparency/transparency.cpu";

// Sharp arms — server-only.
import "./task/image/blur/blur.sharp";
import "./task/image/border/border.sharp";
import "./task/image/brightness/brightness.sharp";
import "./task/image/contrast/contrast.sharp";
import "./task/image/crop/crop.sharp";
import "./task/image/flip/flip.sharp";
import "./task/image/grayscale/grayscale.sharp";
import "./task/image/invert/invert.sharp";
import "./task/image/pixelate/pixelate.sharp";
// posterize, transparency: no sharp arm (cpu/webgpu paths only)
import "./task/image/resize/resize.sharp";
import "./task/image/rotate/rotate.sharp";
import "./task/image/sepia/sepia.sharp";
import "./task/image/threshold/threshold.sharp";
import "./task/image/tint/tint.sharp";

// Opt-in wiring: previewSource (in @workglow/util/media) is a no-op until
// some consumer registers a resize callback. Registering it here, alongside
// the filter-arm side-effects above, ensures that any context that loads
// this codec entry gets preview-time downscale for ImageValue inputs that
// exceed the budget.
import {
  GpuImageFactory,
  applyFilter,
  registerPreviewResizeFn,
} from "@workglow/util/media";

registerPreviewResizeFn(async (value, width, height) => {
  const gpu = await GpuImageFactory.from(value);
  try {
    const out = applyFilter(gpu, "resize", { width, height });
    gpu.dispose();
    return await out.toImageValue(value.previewScale);
  } catch (err) {
    gpu.dispose();
    throw err;
  }
});
