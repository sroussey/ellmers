/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "./media/imageCacheCodec";
import "./media/imageHydrationResolver";

export * from "./media/color";
export { CpuImage } from "./media/cpuImage";
export { rawPixelBufferToBlob, rawPixelBufferToDataUri } from "./media/encode";
export {
  _resetFilterRegistryForTests,
  applyFilter,
  hasFilterOp,
  registerFilterOp,
} from "./media/filterRegistry";
export type { FilterOpFn } from "./media/filterRegistry";
export { getGpuDevice, resetGpuDeviceForTests } from "./media/gpuDevice.browser";
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
export { ImageValueSchema } from "./media/imageValueSchema";
export * from "./media/imageRasterCodecRegistry";
export type { ImageChannels } from "./media/imageTypes";
export type { RawPixelBuffer, RgbaPixelBuffer } from "./media/rawPixelBuffer";
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
export * from "./media/MediaRawImage";
export {
  getPreviewBudget,
  previewSource,
  registerPreviewResizeFn,
  setPreviewBudget,
} from "./media/previewBudget";
export {
  createShaderCache,
  getShaderCache,
  PASSTHROUGH_SHADER_SRC,
  VERTEX_PRELUDE,
} from "./media/shaderRegistry.browser";
export type { ShaderCache } from "./media/shaderRegistry.browser";
export {
  createTexturePool,
  getTexturePool,
  resetTexturePoolForTests,
} from "./media/texturePool.browser";
export type { TexturePool, TexturePoolOptions } from "./media/texturePool.browser";
export { WebGpuImage } from "./media/webGpuImage.browser";
export type { ApplyParams } from "./media/webGpuImage.browser";

// Throwing stubs for server-only sharp helpers. These exist so cross-platform
// consumers (e.g. `@workglow/ai-provider/common/imageOutputHelpers`) can
// statically import the helpers without browser bundlers tripping on missing
// exports. Runtime gates (`if (HAS_BUFFER)` etc.) ensure these are never
// called on the browser path.
export async function probeImageDimensions(): Promise<never> {
  throw new Error("probeImageDimensions: not available in browser runtime");
}
export async function decodeBufferToRaw(): Promise<never> {
  throw new Error("decodeBufferToRaw: not available in browser runtime");
}
export async function encodeRawPixels(): Promise<never> {
  throw new Error("encodeRawPixels: not available in browser runtime");
}

import { CpuImage as _CpuImage } from "./media/cpuImage";
import { getGpuDevice as _getGpuDevice } from "./media/gpuDevice.browser";
import { registerGpuImageFactory as _registerGpuImageFactory } from "./media/gpuImage";
import type { ImageValue as _ImageValue } from "./media/imageValue";
import { WebGpuImage as _WebGpuImage } from "./media/webGpuImage.browser";

async function _preferGpu(value: _ImageValue) {
  const dev = await _getGpuDevice();
  return dev ? _WebGpuImage.from(value) : _CpuImage.from(value);
}

_registerGpuImageFactory("from", _preferGpu);
