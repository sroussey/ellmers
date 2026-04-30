/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for AI provider run/stream functions that produce image
 * outputs. Each helper takes a wire form delivered by a provider SDK
 * (encoded PNG/JPEG bytes, a base64 data URI, or a Blob) and returns a
 * platform-appropriate {@link ImageValue}:
 *
 *   - Node / Bun: a {@link NodeImageValue} wrapping the encoded bytes plus
 *     dimensions read from a sharp metadata probe. The encoded buffer is
 *     retained as-is — no decode/re-encode round trip.
 *   - Browser: a {@link BrowserImageValue} wrapping an `ImageBitmap`
 *     created via `createImageBitmap(blob)`.
 *
 * Provider responses are always either PNG or JPEG. WebP and other formats
 * are not produced by the supported endpoints and would need explicit
 * mime detection if added later.
 */

import type { ImageValue, NodeImageFormat } from "@workglow/util/media";
import {
  encodeRawPixels,
  imageValueFromBitmap,
  imageValueFromBuffer,
  probeImageDimensions,
} from "@workglow/util/media";

// Prefer the browser path when `createImageBitmap` is available — handles
// browser-like runtimes that polyfill `Buffer` (e.g. some test harnesses).
// Node bundles tree-shake `createImageBitmap` to undefined.
const HAS_BUFFER = typeof Buffer !== "undefined";
const HAS_CREATE_IMAGE_BITMAP =
  typeof createImageBitmap === "function" && typeof fetch === "function";
const PREFER_BROWSER = HAS_CREATE_IMAGE_BITMAP;

function detectFormatFromMime(mime: string): NodeImageFormat {
  if (/jpe?g/i.test(mime)) return "jpeg";
  return "png";
}

/**
 * Wrap an encoded image buffer in a Node {@link ImageValue}. Reads
 * width/height via a sharp metadata probe; no pixel decode is performed.
 */
export async function pngBytesToImageValue(
  bytes: Uint8Array,
  format: NodeImageFormat = "png",
): Promise<ImageValue> {
  // `imageValueFromBuffer` requires a Buffer; copy the typed-array view
  // into a fresh Buffer so we don't accidentally retain SharedArrayBuffer
  // memory or alias a pool slice.
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { width, height } = await probeImageDimensions(buffer);
  return imageValueFromBuffer(buffer, format, width, height);
}

/**
 * Decode a `data:<mime>;base64,...` URI into an {@link ImageValue}.
 * On node, retains the encoded bytes via {@link pngBytesToImageValue}. In a
 * browser environment, decodes via `createImageBitmap` instead.
 */
export async function dataUriToImageValue(dataUri: string): Promise<ImageValue> {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUri);
  if (!match) {
    const preview = dataUri.length > 32 ? `${dataUri.slice(0, 32)}...` : dataUri;
    throw new Error(`dataUriToImageValue: invalid data URI "${preview}"`);
  }
  const mime = match[1];
  const base64 = match[2];

  if (PREFER_BROWSER) {
    const blob = await (await fetch(dataUri)).blob();
    const bitmap = await createImageBitmap(blob);
    return imageValueFromBitmap(bitmap, bitmap.width, bitmap.height);
  }

  if (HAS_BUFFER) {
    const buffer = Buffer.from(base64, "base64");
    return pngBytesToImageValue(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      detectFormatFromMime(mime),
    );
  }

  throw new Error("dataUriToImageValue: no Buffer or createImageBitmap available in this runtime");
}

/**
 * Convert a `Blob` (e.g. from the HF Inference SDK) into an
 * {@link ImageValue}. On node uses sharp metadata to size the wrapper; in
 * a browser uses `createImageBitmap` directly.
 */
export async function blobToImageValue(blob: Blob): Promise<ImageValue> {
  if (PREFER_BROWSER) {
    const bitmap = await createImageBitmap(blob);
    return imageValueFromBitmap(bitmap, bitmap.width, bitmap.height);
  }
  if (HAS_BUFFER) {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    return pngBytesToImageValue(bytes, detectFormatFromMime(blob.type || "image/png"));
  }
  throw new Error("blobToImageValue: no Buffer or createImageBitmap available in this runtime");
}

/**
 * Encode an inbound provider-input image into PNG bytes suitable for upload.
 *
 * Accepts the wire forms an `ImageValue` port may carry into a worker:
 *   - {@link NodeImageValue} — encodes via sharp (raw-rgba) or returns bytes
 *     directly if already PNG/JPEG.
 *   - {@link BrowserImageValue} — encodes via canvas/`OffscreenCanvas`.
 *   - `data:` URI string — legacy materialization form; base64-decodes the
 *     payload.
 *
 * Always returns PNG bytes. Callers wrap the result in whatever transport
 * shape the SDK expects (Blob, File, OpenAI.toFile, inlineData Part).
 */
export async function imageValueToPngBytes(
  image: unknown,
): Promise<Uint8Array> {
  if (typeof image === "string") {
    // Legacy data URI from prior materialization. Decode base64.
    const match = /^data:[^;,]+;base64,(.+)$/.exec(image);
    if (!match) {
      const preview = image.length > 32 ? `${image.slice(0, 32)}...` : image;
      throw new Error(`imageValueToPngBytes: invalid data URI "${preview}"`);
    }
    if (typeof Buffer !== "undefined") {
      const buf = Buffer.from(match[1], "base64");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const bin = atob(match[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  if (image && typeof image === "object") {
    // NodeImageValue path — has a `buffer` and `format`.
    const node = image as { buffer?: Buffer; format?: NodeImageFormat; width?: number; height?: number };
    if (
      typeof Buffer !== "undefined" &&
      Buffer.isBuffer(node.buffer) &&
      typeof node.format === "string"
    ) {
      if (node.format === "png" || node.format === "jpeg") {
        return new Uint8Array(node.buffer.buffer, node.buffer.byteOffset, node.buffer.byteLength);
      }
      // raw-rgba — re-encode via sharp.
      if (
        node.format === "raw-rgba" &&
        typeof node.width === "number" &&
        typeof node.height === "number"
      ) {
        const out = await encodeRawPixels(
          { data: node.buffer, width: node.width, height: node.height, channels: 4 },
          { format: "png" },
        );
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      }
    }
    // BrowserImageValue path — has a `bitmap`.
    const browser = image as { bitmap?: ImageBitmap; width?: number; height?: number };
    if (
      typeof ImageBitmap !== "undefined" &&
      browser.bitmap instanceof ImageBitmap &&
      typeof browser.width === "number" &&
      typeof browser.height === "number"
    ) {
      return await encodeBitmapToPngBytes(browser.bitmap, browser.width, browser.height);
    }
  }

  throw new Error("imageValueToPngBytes: unsupported image input shape");
}

/**
 * Encode an inbound provider-input image into a PNG `Blob` suitable for SDKs
 * that accept Blob/File-shaped inputs (e.g. HuggingFace Transformers.js
 * pipelines). Thin wrapper around {@link imageValueToPngBytes}.
 */
export async function imageValueToBlob(image: unknown): Promise<Blob> {
  const bytes = await imageValueToPngBytes(image);
  // The DOM `BlobPart` type expects `Uint8Array<ArrayBuffer>` (not the
  // wider `ArrayBufferLike` union our `Uint8Array` carries). Cast through
  // `BlobPart` to avoid the spurious SharedArrayBuffer narrowing error;
  // the runtime accepts either backing buffer kind.
  return new Blob([bytes as unknown as BlobPart], { type: "image/png" });
}

async function encodeBitmapToPngBytes(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("encodeBitmapToPngBytes: 2d context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  throw new Error("encodeBitmapToPngBytes: OffscreenCanvas not available in this runtime");
}
