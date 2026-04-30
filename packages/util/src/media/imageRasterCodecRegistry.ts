/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RawPixelBuffer } from "./rawPixelBuffer";

export interface ImageRasterCodec {
  decodeDataUri(dataUri: string): Promise<RawPixelBuffer>;
  encodeDataUri(image: RawPixelBuffer, mimeType: string): Promise<string>;
}

// Cross-bundle singleton — Vite/Rolldown can produce multiple bundle copies
// of this file (e.g. one inlined into the app entry, one inlined into a
// worker entry). Without sharing through globalThis, tasks would register
// the codec into one copy while the runner queries another and throws.
const GLOBAL_CODEC_KEY = Symbol.for("@workglow/util/media/imageRasterCodec");
const _g = globalThis as Record<symbol, unknown>;

interface CodecSlot { value: ImageRasterCodec | null; }
if (!_g[GLOBAL_CODEC_KEY]) {
  _g[GLOBAL_CODEC_KEY] = { value: null } satisfies CodecSlot;
}
const slot = _g[GLOBAL_CODEC_KEY] as CodecSlot;

export function registerImageRasterCodec(next: ImageRasterCodec): void {
  slot.value = next;
}

export function getImageRasterCodec(): ImageRasterCodec {
  if (!slot.value) {
    throw new Error(
      "Image raster codec is not registered. Ensure you import @workglow/tasks from the browser or Node entry (dist/browser.js or dist/node.js), or call registerImageRasterCodec() during startup."
    );
  }
  return slot.value;
}
