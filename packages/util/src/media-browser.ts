/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

import { CpuImage as _CpuImage } from "./media/cpuImage";
import { getGpuDevice as _getGpuDevice } from "./media/gpuDevice.browser";
import { registerGpuImageFactory as _registerGpuImageFactory } from "./media/gpuImage";
import "./media/imageCacheCodec";
import "./media/imageHydrationResolver";
import type { ImageValue as _ImageValue } from "./media/imageValue";
import type { EncodeRawPixelsOptions } from "./media/sharpImage.server";
import { WebGpuImage as _WebGpuImage } from "./media/webGpuImage.browser";
export { registerImageDefaults } from "./media/imageHydrationResolver";

export * from "./media/color";
export { dataUriToBlob } from "./media/dataUri";
export { CpuImage } from "./media/cpuImage";
export { rawPixelBufferToBlob, rawPixelBufferToDataUri } from "./media/encode";
export { applyFilter, hasFilterOp, registerFilterOp } from "./media/filterRegistry";
export type { FilterOpFn } from "./media/filterRegistry";
export { getGpuDevice } from "./media/gpuDevice.browser";
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
export {
  createShaderCache,
  getShaderCache,
  PASSTHROUGH_SHADER_SRC,
  VERTEX_PRELUDE,
} from "./media/shaderRegistry.browser";
export type { ShaderCache } from "./media/shaderRegistry.browser";
export { createTexturePool, getTexturePool } from "./media/texturePool.browser";
export type { TexturePool, TexturePoolOptions } from "./media/texturePool.browser";
export { WebGpuImage } from "./media/webGpuImage.browser";
export type { ApplyParams } from "./media/webGpuImage.browser";

// Throwing stubs for server-only sharp helpers. These exist so cross-platform
// consumers (e.g. `@workglow/ai/provider-utils/imageOutputHelpers`) can
// statically import the helpers without browser bundlers tripping on missing
// exports.
export async function probeImageDimensions(_: any): Promise<any> {
  throw new Error("probeImageDimensions: not available in browser runtime");
}
export async function decodeBufferToRaw(_: any): Promise<any> {
  throw new Error("decodeBufferToRaw: not available in browser runtime");
}
export async function encodeRawPixels(_: any, _options: EncodeRawPixelsOptions): Promise<any> {
  throw new Error("encodeRawPixels: not available in browser runtime");
}

async function _preferGpu(value: _ImageValue) {
  const dev = await _getGpuDevice();
  return dev ? _WebGpuImage.from(value) : _CpuImage.from(value);
}

_registerGpuImageFactory("from", _preferGpu);

import { resetGpuDeviceForTests } from "./media/gpuDevice.browser";
import { resetTexturePoolForTests } from "./media/texturePool.browser";

/**
 * @internal Plumbing for the `@workglow/util/test` entry, which is the documented
 * surface. It must be reachable from this bundle so both entries share one module
 * instance — a separate bundle would get its own copy of the registries these
 * reset. Do not import this directly; import `@workglow/util/test`.
 */
export const _internal = {
  resetGpuDeviceForTests,
  resetTexturePoolForTests,
} as const;
