/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maximum number of decoded pixels (width * height) accepted by the image raster codec.
 *
 * Caps worst-case RGBA allocation at ~400 MiB (100 MP * 4 bytes/pixel). Legitimate
 * photographic content rarely exceeds ~50 MP; synthetic pipelines that need more
 * should bypass the codec and operate on RawPixelBuffer directly.
 *
 * Defends against header-declared pixel bombs where a small compressed payload
 * claims billions of pixels to force a downstream OOM.
 */
export const MAX_DECODED_PIXELS = 100_000_000;

/**
 * Maximum raw (base64-decoded) byte size of an incoming data URI on the Node codec.
 *
 * This is a coarse pre-filter before format-specific decoding. The Node codec
 * additionally enforces {@link MAX_DECODED_PIXELS} via sharp's header-level
 * `limitInputPixels`, so 64 MiB is a comfortable ceiling on the server side.
 */
export const MAX_INPUT_BYTES_NODE = 64 * 1024 * 1024;

/**
 * Maximum raw byte size of an incoming data URI on the browser codec.
 *
 * `createImageBitmap` eagerly decompresses before we can observe the bitmap's
 * dimensions, so bounding the compressed input is the primary defense — the
 * post-bitmap `assertWithinPixelBudget` check only avoids the subsequent
 * canvas + ImageData allocations.
 *
 * Sized to fit a worst-case 4K PNG (3840×2160 RGBA = ~32 MiB raw, which a
 * maximum-entropy lossless encode can approach byte-for-byte). Routine 4K
 * photos sit at 10–20 MiB. Anything larger than this is either an 8K image
 * or a malformed input and should be downscaled before upload.
 */
export const MAX_INPUT_BYTES_BROWSER = 32 * 1024 * 1024;

/**
 * Mime types rejected at decode time because rasterization would silently lose
 * information (vector data, animation frames). Callers that need these formats
 * must convert to PNG/JPEG/WebP externally before invoking the codec.
 *
 * Known limitations:
 * - APNG declared as `image/png` cannot be distinguished by mime type alone;
 *   sharp will decode only the first frame. True APNG rejection requires
 *   post-decode metadata inspection (`pages > 1`).
 * - Animated WebP declared as `image/webp` has the same limitation.
 */
export const REJECTED_DECODE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/svg+xml",
  "image/svg",
  "image/gif",
  "image/apng",
]);

/** Output formats the codec is willing to produce. Everything else throws at encode. */
export const SUPPORTED_OUTPUT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedOutputMimeType = (typeof SUPPORTED_OUTPUT_MIME_TYPES)[number];

/**
 * Throws if the decoded image would exceed {@link MAX_DECODED_PIXELS}, or if
 * the dimensions are non-finite or non-positive.
 */
export function assertWithinPixelBudget(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Image raster codec: invalid dimensions ${width}x${height}`);
  }
  const pixels = width * height;
  if (pixels > MAX_DECODED_PIXELS) {
    throw new Error(
      `Image raster codec: decoded image exceeds pixel budget ` +
        `(${width}x${height} = ${pixels} > ${MAX_DECODED_PIXELS})`
    );
  }
}

/** Throws if `byteLength` exceeds `limit`. */
export function assertWithinByteBudget(byteLength: number, limit: number): void {
  if (byteLength > limit) {
    throw new Error(`Image raster codec: input exceeds byte budget (${byteLength} > ${limit})`);
  }
}

/**
 * Returns a safe preview of `value` for error messages.
 *
 * - Non-strings are coerced with `String()`.
 * - `data:` URIs have everything after the first comma replaced with
 *   `[REDACTED]` so that base64-encoded image bytes are never written to
 *   logs or telemetry.
 * - All other strings are truncated to 80 characters.
 */
function formatDataUriErrorPreview(value: unknown): string {
  if (typeof value !== "string") {
    return String(value);
  }

  if (value.startsWith("data:")) {
    const commaIndex = value.indexOf(",");
    if (commaIndex >= 0) {
      return `${value.slice(0, commaIndex)},[REDACTED]`;
    }
    return `${value.slice(0, 80)}${value.length > 80 ? "…" : ""}`;
  }

  return `${value.slice(0, 80)}${value.length > 80 ? "…" : ""}`;
}

/**
 * Throws unless `value` is a string that starts with `data:`. Defense in depth
 * at the codec boundary — prevents the browser codec's `fetch(value)` from ever
 * reaching the network (`http:`, `file:`, etc.) even if an upstream validator
 * is removed or bypassed.
 */
export function assertIsDataUri(value: string): void {
  if (typeof value !== "string" || !value.startsWith("data:")) {
    const preview = formatDataUriErrorPreview(value);
    throw new Error(`Image raster codec: expected a data: URI but received "${preview}"`);
  }
}

/**
 * Extracts the mime type from a data URI for pre-decode validation. Returns
 * the lowercased mime type, or `undefined` if not parseable.
 *
 * Intentionally looser than `parseDataUri` in `@workglow/util/media`: this lets
 * us report "unsupported svg+xml" before failing on an otherwise-malformed data
 * URI, so the caller gets the most actionable error.
 */
export function extractDataUriMimeType(dataUri: string): string | undefined {
  const match = dataUri.match(/^data:([^;,]+)/);
  return match?.[1]?.trim().toLowerCase();
}

/**
 * Normalizes and validates an output mime type. Throws for unsupported or
 * lossy types (e.g. `image/svg+xml`, `image/gif`) instead of silently falling
 * through to PNG. Replaces the per-file `normalizeMimeType` helpers that used
 * to mask format mismatches.
 */
export function normalizeOutputMimeType(mimeType: string): SupportedOutputMimeType {
  const m = mimeType.toLowerCase().trim();
  if (m === "image/jpeg" || m === "image/jpg") {
    return "image/jpeg";
  }
  if (m === "image/png") {
    return "image/png";
  }
  if (m === "image/webp") {
    return "image/webp";
  }
  throw new Error(
    `Image raster codec: unsupported output mime type "${mimeType}". ` +
      `Supported: ${SUPPORTED_OUTPUT_MIME_TYPES.join(", ")}.`
  );
}
