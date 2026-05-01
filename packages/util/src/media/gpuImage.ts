/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageChannels } from "./imageTypes";
import type { ImageValue } from "./imageValue";

export type GpuImageBackend = "webgpu" | "sharp" | "cpu";
export type GpuImageEncodeFormat = "png" | "jpeg" | "webp";

/**
 * `GpuImage` is a private implementation detail of image tasks: it never
 * crosses a task/engine/worker boundary. Lives only inside an
 * `ImageFilterTask.execute` method body. Cross-boundary currency is
 * `ImageValue`. Use `GpuImage.from(value)` at task entry and
 * `imageValueFromGpu(out, scale)` (or `transferToImageBitmap()` /
 * `toBuffer()` directly) at task exit.
 */
export interface GpuImage {
  readonly width: number;
  readonly height: number;
  readonly channels: ImageChannels;
  readonly backend: GpuImageBackend;
  /** Materialize back into a wire-form `ImageValue`. Always returns a fresh
   *  ImageValue; the caller is the new owner. */
  toImageValue(previewScale: number): Promise<ImageValue>;
  /** Encode to a compressed image format (png/jpeg/webp). Implementations MAY
   *  consume the underlying resource — treat as single-use. */
  encode(format: GpuImageEncodeFormat, quality?: number): Promise<Uint8Array>;
  /** Early cleanup on error paths only. Required because GPU/native resources
   *  are not held by GC. The happy path uses `toImageValue()` which transfers
   *  ownership; this is the abort/error case. */
  dispose(): void;
}

export interface GpuImageStatic {
  /** Bridge from the cross-boundary `ImageValue` to a backend-private GpuImage. */
  from(value: ImageValue): Promise<GpuImage>;
}

const GLOBAL_FACTORY_KEY = Symbol.for("@workglow/util/media/gpuImageFactory");
const _g = globalThis as Record<symbol, unknown>;
if (!_g[GLOBAL_FACTORY_KEY]) {
  _g[GLOBAL_FACTORY_KEY] = {} as Record<string, unknown>;
}
const factory = _g[GLOBAL_FACTORY_KEY] as Record<string, unknown>;

export function registerGpuImageFactory<K extends keyof GpuImageStatic>(
  key: K,
  fn: GpuImageStatic[K],
): void {
  factory[key] = fn;
}

export function getGpuImageFactory<K extends keyof GpuImageStatic>(
  key: K,
): GpuImageStatic[K] | undefined {
  const fn = factory[key];
  return typeof fn === "function" ? (fn as GpuImageStatic[K]) : undefined;
}

export const GpuImage: GpuImageStatic = new Proxy({} as GpuImageStatic, {
  get(_t, prop) {
    if (typeof prop !== "string" || prop === "then") return undefined;
    const fn = factory[prop];
    if (typeof fn !== "function") {
      throw new Error(`GpuImage.${prop} is not registered. Import the platform entry point.`);
    }
    return fn;
  },
});
