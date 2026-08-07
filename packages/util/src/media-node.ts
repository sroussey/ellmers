/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

import "./media/imageCacheCodec";
import "./media/imageHydrationResolver";
export { registerImageDefaults } from "./media/imageHydrationResolver";

export * from "./media/color";
export { dataUriToBlob } from "./media/dataUri";
export { CpuImage } from "./media/cpuImage";
export { rawPixelBufferToBlob, rawPixelBufferToDataUri } from "./media/encode";
export { applyFilter, hasFilterOp, registerFilterOp } from "./media/filterRegistry";
export type { FilterOpFn } from "./media/filterRegistry";
export {
  getGpuImageFactory,
  GpuImage as GpuImageFactory,
  registerGpuImageFactory,
} from "./media/gpuImage";
export type {
  GpuImage,
  GpuImageBackend,
  GpuImageEncodeFormat,
  GpuImageStatic,
} from "./media/gpuImage";
export * from "./media/imageRasterCodecRegistry";
export type { ImageChannels } from "./media/imageTypes";
export {
  imageValueFromBitmap,
  imageValueFromBuffer,
  isBrowserImageValue,
  isImageValue,
  isNodeImageValue,
  normalizeToImageValue,
} from "./media/imageValue";
export type {
  BrowserImageValue,
  ImageValue,
  ImageValueBase,
  NodeImageFormat,
  NodeImageValue,
} from "./media/imageValue";
export { ImageValueSchema } from "./media/imageValueSchema";
export type { WithImageValuePorts } from "./media/imageValueSchema";
export * from "./media/MediaRawImage";
export {
  getPreviewBudget,
  previewSource,
  registerPreviewResizeFn,
  setPreviewBudget,
} from "./media/previewBudget";
export type { RawPixelBuffer, RgbaPixelBuffer } from "./media/rawPixelBuffer";
export async function getGpuDevice(): Promise<null> {
  return null;
}
export {
  createShaderCache,
  getShaderCache,
  PASSTHROUGH_SHADER_SRC,
  VERTEX_PRELUDE,
} from "./media/shaderRegistry.browser";
export type { ShaderCache } from "./media/shaderRegistry.browser";
export { createTexturePool, getTexturePool } from "./media/texturePool.browser";
export type { TexturePool, TexturePoolOptions } from "./media/texturePool.browser";
// WebGpuImage is browser-only at runtime; type-only re-export lets
// browser-targeted filter files (*.webgpu.ts) type-check under node tsc.
export {
  decodeBufferToRaw,
  encodeRawPixels,
  probeImageDimensions,
  SharpImage,
} from "./media/sharpImage.server";
export type {
  DecodeBufferToRawOptions,
  EncodeRawPixelsOptions,
  RawPixelInput,
} from "./media/sharpImage.server";
export type { ApplyParams, WebGpuImage } from "./media/webGpuImage.browser";

import { registerGpuImageFactory as _registerGpuImageFactory } from "./media/gpuImage";
import type { ImageValue as _ImageValue } from "./media/imageValue";
import { SharpImage as _SharpImage } from "./media/sharpImage.server";
import { resetTexturePoolForTests } from "./media/texturePool.browser";

_registerGpuImageFactory("from", (value: _ImageValue) => _SharpImage.from(value));

/**
 * @internal Plumbing for the `@workglow/util/test` entry, which is the documented
 * surface. It must be reachable from this bundle so both entries share one module
 * instance — a separate bundle would get its own copy of the registries these
 * reset. Do not import this directly; import `@workglow/util/test`.
 */
export const _internal = {
  resetGpuDeviceForTests: (): void => {},
  resetTexturePoolForTests,
} as const;
