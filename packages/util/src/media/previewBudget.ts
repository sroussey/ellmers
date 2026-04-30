/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageValue } from "./imageValue";

// Cross-bundle singleton — Vite/Rolldown can produce multiple bundle copies of
// this file (one per consumer, browser/node entry, the builder web app, etc.).
// Without sharing through `globalThis`, `setPreviewBudget` / `registerPreview-
// ResizeFn` would silently no-op in any bundle that didn't perform the call,
// because each bundle would hold its own module-private slot. Same pattern as
// the codec / GpuImage factory registries (see `imageRasterCodecRegistry.ts`
// and `gpuImage.ts`). The `Symbol.for` keys are stable across realms so every
// bundle hits the same record.
const GLOBAL_RESIZE_KEY = Symbol.for("@workglow/util/media/previewResizeFn");
const GLOBAL_BUDGET_KEY = Symbol.for("@workglow/util/media/previewBudget");
const _g = globalThis as Record<symbol, unknown>;

export type PreviewResizeFn = (
  image: ImageValue,
  width: number,
  height: number,
) => Promise<ImageValue>;

const DEFAULT_BUDGET = 512;

if (typeof _g[GLOBAL_BUDGET_KEY] !== "number") {
  _g[GLOBAL_BUDGET_KEY] = DEFAULT_BUDGET;
}

export function registerPreviewResizeFn(fn: PreviewResizeFn | undefined): void {
  _g[GLOBAL_RESIZE_KEY] = fn;
}

function getPreviewResizeFn(): PreviewResizeFn | undefined {
  return _g[GLOBAL_RESIZE_KEY] as PreviewResizeFn | undefined;
}

export function getPreviewBudget(): number {
  return _g[GLOBAL_BUDGET_KEY] as number;
}

export function setPreviewBudget(px: number): void {
  if (!Number.isFinite(px) || px <= 0) {
    throw new Error(`setPreviewBudget: invalid value ${px}; expected a positive finite number`);
  }
  _g[GLOBAL_BUDGET_KEY] = Math.floor(px);
}

/**
 * Engine-applied chain-head downscale for `runPreview`. Idempotent: when
 * the input is already within budget, returns the input unchanged
 * (referential equality is the no-op signal). When over budget, calls the
 * registered resize fn (typically routed through Sharp on node and an
 * OffscreenCanvas/WebGPU resize on browser) and composes `previewScale`:
 * `out.previewScale = in.previewScale × downscaleRatio`.
 */
export async function previewSource(image: ImageValue): Promise<ImageValue> {
  const budget = getPreviewBudget();
  const long = Math.max(image.width, image.height);
  if (long <= budget) return image;
  const ratio = budget / long;
  const resize = getPreviewResizeFn();
  if (!resize) return image;
  const targetW = Math.max(1, Math.round(image.width * ratio));
  const targetH = Math.max(1, Math.round(image.height * ratio));
  const result = await resize(image, targetW, targetH);
  const composedScale = image.previewScale * ratio;
  return {
    ...result,
    previewScale: composedScale,
  } as ImageValue;
}
