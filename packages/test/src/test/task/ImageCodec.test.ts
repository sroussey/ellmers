/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MAX_DECODED_PIXELS,
  MAX_INPUT_BYTES_BROWSER,
  MAX_INPUT_BYTES_NODE,
  REJECTED_DECODE_MIME_TYPES,
  assertIsDataUri,
  assertWithinByteBudget,
  assertWithinPixelBudget,
  extractDataUriMimeType,
  getImageRasterCodec,
  normalizeOutputMimeType,
} from "@workglow/tasks";
import type { RawPixelBuffer } from "@workglow/util/media";
import { describe, expect, test } from "vitest";

/** Minimal valid 1×1 RGB PNG (shared with ImageTask.test.ts). */
const PNG_1X1_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGPgEpEDAABoAD1UCKP3AAAAAElFTkSuQmCC";

/** Minimal valid 1×1 GIF89a data URI. Used to confirm GIF is rejected outright. */
const GIF_1X1_DATA_URI = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=";

/** Minimal valid 1×1 SVG data URI. Used to confirm SVG is rejected outright. */
const SVG_1X1_DATA_URI =
  "data:image/svg+xml;base64," +
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', "utf8").toString(
    "base64"
  );

describe("imageCodecLimits helpers", () => {
  describe("assertWithinPixelBudget", () => {
    test("accepts small positive dimensions", () => {
      expect(() => assertWithinPixelBudget(1, 1)).not.toThrow();
      expect(() => assertWithinPixelBudget(1920, 1080)).not.toThrow();
    });

    test("accepts a square exactly at the budget", () => {
      const side = Math.floor(Math.sqrt(MAX_DECODED_PIXELS));
      expect(() => assertWithinPixelBudget(side, side)).not.toThrow();
    });

    test("rejects dimensions exceeding the budget", () => {
      expect(() => assertWithinPixelBudget(20_000, 20_000)).toThrow(/pixel budget/);
    });

    test("rejects non-finite or non-positive dimensions", () => {
      expect(() => assertWithinPixelBudget(0, 1)).toThrow(/invalid dimensions/);
      expect(() => assertWithinPixelBudget(-1, 1)).toThrow(/invalid dimensions/);
      expect(() => assertWithinPixelBudget(Number.POSITIVE_INFINITY, 1)).toThrow(
        /invalid dimensions/
      );
      expect(() => assertWithinPixelBudget(Number.NaN, 1)).toThrow(/invalid dimensions/);
    });
  });

  describe("assertWithinByteBudget", () => {
    test("accepts lengths at or below the limit", () => {
      expect(() => assertWithinByteBudget(0, 100)).not.toThrow();
      expect(() => assertWithinByteBudget(100, 100)).not.toThrow();
    });

    test("rejects lengths above the limit", () => {
      expect(() => assertWithinByteBudget(101, 100)).toThrow(/byte budget/);
      expect(() => assertWithinByteBudget(MAX_INPUT_BYTES_NODE + 1, MAX_INPUT_BYTES_NODE)).toThrow(
        /byte budget/
      );
      expect(() =>
        assertWithinByteBudget(MAX_INPUT_BYTES_BROWSER + 1, MAX_INPUT_BYTES_BROWSER)
      ).toThrow(/byte budget/);
    });
  });

  describe("assertIsDataUri", () => {
    test("accepts data URIs", () => {
      expect(() => assertIsDataUri(PNG_1X1_DATA_URI)).not.toThrow();
      expect(() => assertIsDataUri("data:image/png;base64,xxx")).not.toThrow();
    });

    test("rejects http(s) and file URLs", () => {
      expect(() => assertIsDataUri("http://evil.example/x.png")).toThrow(/expected a data: URI/);
      expect(() => assertIsDataUri("https://evil.example/x.png")).toThrow(/expected a data: URI/);
      expect(() => assertIsDataUri("file:///etc/passwd")).toThrow(/expected a data: URI/);
    });

    test("rejects empty and non-data strings", () => {
      expect(() => assertIsDataUri("")).toThrow(/expected a data: URI/);
      expect(() => assertIsDataUri("not a uri")).toThrow(/expected a data: URI/);
    });
  });

  describe("extractDataUriMimeType", () => {
    test("extracts and lowercases the mime type", () => {
      expect(extractDataUriMimeType("data:image/png;base64,xxx")).toBe("image/png");
      expect(extractDataUriMimeType("data:image/JPEG;base64,xxx")).toBe("image/jpeg");
      expect(extractDataUriMimeType("data:image/SVG+XML;base64,xxx")).toBe("image/svg+xml");
    });

    test("returns undefined for non-data strings", () => {
      expect(extractDataUriMimeType("not a uri")).toBeUndefined();
      expect(extractDataUriMimeType("")).toBeUndefined();
    });
  });

  describe("normalizeOutputMimeType", () => {
    test("maps supported types to canonical form", () => {
      expect(normalizeOutputMimeType("image/jpeg")).toBe("image/jpeg");
      expect(normalizeOutputMimeType("image/JPG")).toBe("image/jpeg");
      expect(normalizeOutputMimeType("image/png")).toBe("image/png");
      expect(normalizeOutputMimeType("image/webp")).toBe("image/webp");
      expect(normalizeOutputMimeType("  image/PNG  ")).toBe("image/png");
    });

    test("throws for vector/animated types instead of silently falling back to PNG", () => {
      // This is the critical regression test for the silent-PNG re-encode bug.
      expect(() => normalizeOutputMimeType("image/svg+xml")).toThrow(/unsupported output/);
      expect(() => normalizeOutputMimeType("image/gif")).toThrow(/unsupported output/);
      expect(() => normalizeOutputMimeType("image/apng")).toThrow(/unsupported output/);
    });

    test("throws for arbitrary non-image types", () => {
      expect(() => normalizeOutputMimeType("application/json")).toThrow(/unsupported output/);
      expect(() => normalizeOutputMimeType("")).toThrow(/unsupported output/);
    });
  });

  describe("REJECTED_DECODE_MIME_TYPES", () => {
    test("covers known lossy formats", () => {
      expect(REJECTED_DECODE_MIME_TYPES.has("image/svg+xml")).toBe(true);
      expect(REJECTED_DECODE_MIME_TYPES.has("image/svg")).toBe(true);
      expect(REJECTED_DECODE_MIME_TYPES.has("image/gif")).toBe(true);
      expect(REJECTED_DECODE_MIME_TYPES.has("image/apng")).toBe(true);
    });

    test("does not reject the supported raster formats", () => {
      expect(REJECTED_DECODE_MIME_TYPES.has("image/png")).toBe(false);
      expect(REJECTED_DECODE_MIME_TYPES.has("image/jpeg")).toBe(false);
      expect(REJECTED_DECODE_MIME_TYPES.has("image/webp")).toBe(false);
    });
  });
});

describe("Image raster codec security", () => {
  const codec = getImageRasterCodec();

  test("decodeDataUri rejects non-data URIs (SSRF guard)", async () => {
    await expect(codec.decodeDataUri("http://evil.example/x.png")).rejects.toThrow(
      /expected a data: URI/
    );
    await expect(codec.decodeDataUri("file:///etc/passwd")).rejects.toThrow(/expected a data: URI/);
  });

  test("decodeDataUri rejects SVG to prevent silent rasterization", async () => {
    await expect(codec.decodeDataUri(SVG_1X1_DATA_URI)).rejects.toThrow(/refusing to rasterize/);
  });

  test("decodeDataUri rejects GIF to prevent animation-frame loss", async () => {
    await expect(codec.decodeDataUri(GIF_1X1_DATA_URI)).rejects.toThrow(/refusing to rasterize/);
  });

  test("encodeDataUri rejects unsupported output types (no silent PNG fallback)", async () => {
    const image: RawPixelBuffer = {
      data: new Uint8ClampedArray([255, 128, 0]),
      width: 1,
      height: 1,
      channels: 3,
    };
    await expect(codec.encodeDataUri(image, "image/svg+xml")).rejects.toThrow(/unsupported output/);
    await expect(codec.encodeDataUri(image, "image/gif")).rejects.toThrow(/unsupported output/);
  });

  test("decodeDataUri happy path on a 1×1 PNG is unchanged", async () => {
    const result = await codec.decodeDataUri(PNG_1X1_DATA_URI);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect([1, 3, 4]).toContain(result.channels);
    expect(result.data.length).toBe(result.width * result.height * result.channels);
  });

  test("decoded ImageBinary does not alias sharp's pooled Buffer", async () => {
    // Node Buffers up to ~4 KiB are sliced from a shared 8 KiB pool. If the
    // codec returned `new Uint8ClampedArray(data.buffer, data.byteOffset, ...)`,
    // the view's ArrayBuffer would be the full pool slab (≥ 4 KiB) while the
    // view itself covers only a few bytes. A fresh copy allocates an
    // ArrayBuffer sized exactly to the view. This is a direct, deterministic
    // observation of the fix (see imageRasterCodecNode.ts: `new Uint8ClampedArray(data)`).
    const result = await codec.decodeDataUri(PNG_1X1_DATA_URI);
    expect(result.data.buffer.byteLength).toBe(result.data.byteLength);
    expect(result.data.byteOffset).toBe(0);
  });
});
