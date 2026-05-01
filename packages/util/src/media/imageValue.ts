/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getImageRasterCodec } from "./imageRasterCodecRegistry";

export type NodeImageFormat = "png" | "jpeg" | "raw-rgba";

export interface ImageValueBase {
  readonly width: number;
  readonly height: number;
  readonly previewScale: number;
}

export interface BrowserImageValue extends ImageValueBase {
  readonly bitmap: ImageBitmap;
}

export interface NodeImageValue extends ImageValueBase {
  readonly buffer: Buffer;
  readonly format: NodeImageFormat;
}

export type ImageValue = BrowserImageValue | NodeImageValue;

export function imageValueFromBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  previewScale: number = 1.0
): BrowserImageValue {
  return { bitmap, width, height, previewScale };
}

export function imageValueFromBuffer(
  buffer: Buffer,
  format: NodeImageFormat,
  width: number,
  height: number,
  previewScale: number = 1.0
): NodeImageValue {
  return { buffer, format, width, height, previewScale };
}

export function isImageValue(v: unknown): v is ImageValue {
  return isBrowserImageValue(v) || isNodeImageValue(v);
}

export function isBrowserImageValue(v: unknown): v is BrowserImageValue {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    typeof o.previewScale === "number" &&
    typeof ImageBitmap !== "undefined" &&
    o.bitmap instanceof ImageBitmap
  );
}

export function isNodeImageValue(v: unknown): v is NodeImageValue {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    typeof o.previewScale === "number" &&
    typeof Buffer !== "undefined" &&
    Buffer.isBuffer(o.buffer) &&
    (o.format === "png" || o.format === "jpeg" || o.format === "raw-rgba")
  );
}

/**
 * Best-effort normalization at boundaries (input resolver, builder hook).
 * Accepts the wire forms an `ImageValue` port may receive:
 *   - an existing `ImageValue` (passthrough)
 *   - a `data:` URI (browser: decoded via `createImageBitmap`; node: encoded
 *     bytes wrapped in a `NodeImageValue`, with dimensions probed via the
 *     registered raster codec)
 *   - a `Blob` (browser only)
 *   - an `ImageBitmap` (browser only)
 * Returns `undefined` for unrecognized shapes.
 *
 * Note: a raw `Buffer` is intentionally not handled here — callers with
 * encoded bytes plus a format hint should construct one via
 * `imageValueFromBuffer(...)` directly.
 *
 * String dispatch is platform-agnostic; non-string platform-specific shapes
 * are tested via `typeof` guards so the same module loads on browser and node.
 */
export async function normalizeToImageValue(value: unknown): Promise<ImageValue | undefined> {
  if (value === null || value === undefined) return undefined;
  if (isImageValue(value)) return value;

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(value);
      return imageValueFromBitmap(bitmap, bitmap.width, bitmap.height);
    }
    return undefined;
  }

  if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
    return imageValueFromBitmap(value, value.width, value.height);
  }

  if (typeof value === "string" && value.startsWith("data:")) {
    if (typeof createImageBitmap === "function" && typeof fetch === "function") {
      const blob = await (await fetch(value)).blob();
      const bitmap = await createImageBitmap(blob);
      return imageValueFromBitmap(bitmap, bitmap.width, bitmap.height);
    }
    if (typeof Buffer !== "undefined") {
      return decodeDataUriToNodeImageValue(value);
    }
    return undefined;
  }

  return undefined;
}

async function decodeDataUriToNodeImageValue(dataUri: string): Promise<NodeImageValue | undefined> {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUri);
  if (!match) return undefined;
  const mime = match[1] ?? "image/png";
  const base64 = match[2] ?? "";
  const buffer = Buffer.from(base64, "base64");
  const format: NodeImageFormat = /jpe?g/i.test(mime) ? "jpeg" : "png";
  // Probe dimensions through the registered raster codec. Rethrow any codec
  // failure with the original error as `cause` so the underlying problem
  // (no codec registered, malformed payload, etc.) isn't lost behind the
  // resolver's generic "unsupported string" message.
  try {
    const decoded = await getImageRasterCodec().decodeDataUri(dataUri);
    return imageValueFromBuffer(buffer, format, decoded.width, decoded.height);
  } catch (err) {
    throw new Error("normalizeToImageValue: failed to probe data URI dimensions", {
      cause: err,
    });
  }
}
