/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RawPixelBuffer } from "@workglow/util/media";

import {
  MAX_INPUT_BYTES_BROWSER,
  REJECTED_DECODE_MIME_TYPES,
  assertIsDataUri,
  assertWithinByteBudget,
  assertWithinPixelBudget,
  extractDataUriMimeType,
  normalizeOutputMimeType,
} from "./imageCodecLimits";
import type { ImageRasterCodec } from "@workglow/util/media";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(chunks.join(""));
}

function rasterToImageData(image: RawPixelBuffer): ImageData {
  const { width, height, channels, data } = image;
  const id = new ImageData(width, height);
  if (channels === 4) {
    id.data.set(data);
    return id;
  }
  if (channels === 3) {
    for (let i = 0; i < width * height; i++) {
      id.data[i * 4] = data[i * 3]!;
      id.data[i * 4 + 1] = data[i * 3 + 1]!;
      id.data[i * 4 + 2] = data[i * 3 + 2]!;
      id.data[i * 4 + 3] = 255;
    }
    return id;
  }
  if (channels === 1) {
    for (let i = 0; i < width * height; i++) {
      const v = data[i]!;
      id.data[i * 4] = v;
      id.data[i * 4 + 1] = v;
      id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    return id;
  }
  throw new Error(`Unsupported channel count: ${channels}`);
}

function get2dContext(
  width: number,
  height: number
): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context (OffscreenCanvas)");
    }
    return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context (HTMLCanvasElement)");
    }
    return { canvas, ctx };
  }
  throw new Error("No Canvas implementation available in this environment");
}

async function decodeDataUri(dataUri: string): Promise<RawPixelBuffer> {
  // Defense in depth: without this assertion, `fetch(dataUri)` below would
  // happily reach the network for `http:`, `file:`, etc. — turning any future
  // upstream-validation removal into SSRF.
  assertIsDataUri(dataUri);

  const declaredMime = extractDataUriMimeType(dataUri);
  if (declaredMime && REJECTED_DECODE_MIME_TYPES.has(declaredMime)) {
    throw new Error(
      `Image raster codec: refusing to rasterize "${declaredMime}". ` +
        `Vector and animated formats lose information when converted to pixels. ` +
        `Convert to PNG, JPEG, or WebP before passing to the codec.`
    );
  }

  const response = await fetch(dataUri);
  const blob = await response.blob();
  // Compressed-size pre-check is the primary browser defense against decoder
  // bombs: `createImageBitmap` decompresses eagerly, so by the time we can
  // read `bmp.width`/`bmp.height` the expensive allocation has already
  // happened. The subsequent pixel-budget check only avoids the canvas +
  // ImageData allocations (another ~2 * w*h*4 bytes).
  assertWithinByteBudget(blob.size, MAX_INPUT_BYTES_BROWSER);

  const bmp = await createImageBitmap(blob);
  try {
    assertWithinPixelBudget(bmp.width, bmp.height);
    const { ctx } = get2dContext(bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return {
      data: new Uint8ClampedArray(id.data),
      width: id.width,
      height: id.height,
      channels: 4,
    };
  } finally {
    // Always close the bitmap, even on rejection, to avoid leaking a
    // decompressed allocation on every oversized input.
    bmp.close();
  }
}

async function encodeDataUri(image: RawPixelBuffer, mimeType: string): Promise<string> {
  const fmt = normalizeOutputMimeType(mimeType);
  const { canvas, ctx } = get2dContext(image.width, image.height);
  ctx.putImageData(rasterToImageData(image), 0, 0);

  if (canvas instanceof OffscreenCanvas) {
    const quality = fmt === "image/jpeg" ? 0.92 : undefined;
    const blob = await canvas.convertToBlob({ type: fmt, quality });
    const buf = await blob.arrayBuffer();
    return `data:${fmt};base64,${arrayBufferToBase64(buf)}`;
  }

  const htmlCanvas = canvas as HTMLCanvasElement;
  const dataUrl = htmlCanvas.toDataURL(fmt, fmt === "image/jpeg" ? 0.92 : undefined);
  return dataUrl;
}

export function createBrowserImageRasterCodec(): ImageRasterCodec {
  return { decodeDataUri, encodeDataUri };
}
