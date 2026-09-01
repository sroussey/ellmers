/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PermanentJobError } from "@workglow/job-queue";

/**
 * Unwrap an `ImageValue` port payload into something MediaPipe's vision tasks
 * can upload to a texture.
 *
 * The vision tasks take a DOM `TexImageSource` and hand it straight to
 * `texImage2D`. An `ImageValue` is a *wrapper* — `{ bitmap, width, height,
 * previewScale }` in the browser — so passing it through unchanged fails
 * inside the SDK with "Failed to execute 'texImage2D' ... Overload resolution
 * failed", far from the call site that supplied it.
 *
 * Already-unwrapped sources pass through: graphs built before `ImageValue`
 * existed, and callers holding a canvas or video element, still work.
 */
export function toTexImageSource(image: unknown): TexImageSource {
  if (image && typeof image === "object") {
    // BrowserImageValue — the shape the builder's image ports carry.
    const bitmap = (image as { bitmap?: unknown }).bitmap;
    if (typeof ImageBitmap !== "undefined" && bitmap instanceof ImageBitmap) {
      return bitmap;
    }
    if (isTexImageSource(image)) return image;
  }

  throw new PermanentJobError(
    `MediaPipe vision tasks need an image source (ImageBitmap, canvas, video, or ImageData); ` +
      `received ${describe(image)}. A NodeImageValue cannot be used here — this provider is browser-only.`
  );
}

function isTexImageSource(value: object): value is TexImageSource {
  return (
    (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) ||
    (typeof ImageData !== "undefined" && value instanceof ImageData) ||
    (typeof HTMLImageElement !== "undefined" && value instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== "undefined" && value instanceof HTMLCanvasElement) ||
    (typeof HTMLVideoElement !== "undefined" && value instanceof HTMLVideoElement) ||
    (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas)
  );
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value as object);
  const name = (value as object).constructor?.name ?? "object";
  return keys.length > 0 ? `${name} { ${keys.join(", ")} }` : name;
}
