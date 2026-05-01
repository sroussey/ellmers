/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RawPixelBuffer, ImageChannels } from "@workglow/util/media";
import { decodeBufferToRaw, encodeRawPixels } from "@workglow/util/media";

import {
  MAX_DECODED_PIXELS,
  MAX_INPUT_BYTES_NODE,
  REJECTED_DECODE_MIME_TYPES,
  assertIsDataUri,
  assertWithinByteBudget,
  assertWithinPixelBudget,
  extractDataUriMimeType,
  normalizeOutputMimeType,
} from "./imageCodecLimits";
import type { ImageRasterCodec } from "@workglow/util/media";

/** Local copy of the deleted `@workglow/util/media#parseDataUri` helper. Kept
 *  inline so the codec doesn't depend on a util export that was removed when
 *  the boundary refactor migrated callers to `imageValueFromBuffer` / Buffer-
 *  based plumbing. The base64 capture group is used to estimate decoded bytes
 *  before allocation; the mime is read separately via `extractDataUriMimeType`
 *  since it's enforced against an allowlist. */
function parseDataUri(dataUri: string): { mimeType: string; base64: string } {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid base64 data URI");
  return { mimeType: match[1]!, base64: match[2]! };
}

function expandGrayAlphaToRgba(src: Buffer, width: number, height: number): Uint8ClampedArray {
  const n = width * height;
  const dst = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const g = src[i * 2]!;
    const a = src[i * 2 + 1]!;
    dst[i * 4] = g;
    dst[i * 4 + 1] = g;
    dst[i * 4 + 2] = g;
    dst[i * 4 + 3] = a;
  }
  return dst;
}

async function decodeDataUri(dataUri: string): Promise<RawPixelBuffer> {
  // Defense in depth: the codec must not trust its caller. An accidental
  // `fetch`/`Buffer.from` path is not reachable here today, but refusing
  // anything that is not a data URI keeps that door shut.
  assertIsDataUri(dataUri);

  const declaredMime = extractDataUriMimeType(dataUri);
  if (declaredMime && REJECTED_DECODE_MIME_TYPES.has(declaredMime)) {
    throw new Error(
      `Image raster codec: refusing to rasterize "${declaredMime}". ` +
        `Vector and animated formats lose information when converted to pixels. ` +
        `Convert to PNG, JPEG, or WebP before passing to the codec.`
    );
  }

  const { base64 } = parseDataUri(dataUri);

  // Estimate decoded byte count from the base64 string length *before*
  // allocating the buffer. Each 4 base64 characters decode to 3 bytes;
  // ceiling gives a slight over-estimate (≥ real size), so oversized inputs
  // are rejected without touching Buffer.from().
  const estimatedBytes = Math.ceil((base64.length * 3) / 4);
  assertWithinByteBudget(estimatedBytes, MAX_INPUT_BYTES_NODE);

  const buffer = Buffer.from(base64, "base64");

  // `limitInputPixels` rejects header-declared pixel bombs before decompression.
  // `sequentialRead` lowers peak memory for large inputs.
  const { data, width, height, channels: ch } = await decodeBufferToRaw(buffer, {
    limitInputPixels: MAX_DECODED_PIXELS,
    sequentialRead: true,
  });

  // Belt-and-suspenders: sharp should have rejected already, but assert on the
  // post-decode dimensions too so any future sharp option change cannot
  // silently disable the pixel budget.
  assertWithinPixelBudget(width, height);

  if (ch === 2) {
    return {
      data: expandGrayAlphaToRgba(data, width, height),
      width,
      height,
      channels: 4,
    };
  }
  if (ch === 1 || ch === 3 || ch === 4) {
    // IMPORTANT: copy, do not alias. Node Buffers up to ~4 KiB are sliced out
    // of a shared pool (`Buffer.poolSize / 2`), so aliasing `data.buffer`
    // would expose unrelated pool memory through the Uint8ClampedArray view,
    // and downstream pixel mutations would corrupt sibling allocations. The
    // `TypedArray(typedArray)` constructor allocates a fresh ArrayBuffer and
    // element-wise copies — matching the pattern in `expandGrayAlphaToRgba`.
    return {
      data: new Uint8ClampedArray(data),
      width,
      height,
      channels: ch as ImageChannels,
    };
  }
  throw new Error(`Unsupported decoded channel count: ${ch}`);
}

async function encodeDataUri(image: RawPixelBuffer, mimeType: string): Promise<string> {
  const { data, width, height, channels } = image;
  const fmt = normalizeOutputMimeType(mimeType);

  const out =
    fmt === "image/jpeg"
      ? await encodeRawPixels(
          { data, width, height, channels },
          { format: "jpeg", quality: 92, mozjpeg: true }
        )
      : fmt === "image/webp"
        ? await encodeRawPixels(
            { data, width, height, channels },
            { format: "webp", quality: 92 }
          )
        : await encodeRawPixels(
            { data, width, height, channels },
            { format: "png", compressionLevel: 6 }
          );

  return `data:${fmt};base64,${out.toString("base64")}`;
}

export function createNodeImageRasterCodec(): ImageRasterCodec {
  return { decodeDataUri, encodeDataUri };
}
