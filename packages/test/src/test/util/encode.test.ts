/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";
import "@workglow/tasks";
import { rawPixelBufferToBlob, rawPixelBufferToDataUri } from "@workglow/util/media";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

async function blobMagic(blob: Blob, n: number): Promise<number[]> {
  const buf = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buf, 0, n));
}

describe("rawPixelBufferToBlob", () => {
  const bin = { data: new Uint8ClampedArray([10, 20, 30, 255]), width: 1, height: 1, channels: 4 as const };

  test("default mime emits PNG bytes with PNG type", async () => {
    const blob = await rawPixelBufferToBlob(bin);
    expect(blob.type).toBe("image/png");
    expect(await blobMagic(blob, 4)).toEqual(PNG_MAGIC);
  });

  test("explicit image/jpeg emits JPEG bytes with JPEG type", async () => {
    // Sanity: codec actually supports JPEG encode.
    const dataUri = await rawPixelBufferToDataUri(bin, "image/jpeg");
    expect(dataUri.startsWith("data:image/jpeg;")).toBe(true);

    const blob = await rawPixelBufferToBlob(bin, "image/jpeg");
    expect(blob.type).toBe("image/jpeg");
    expect(await blobMagic(blob, 3)).toEqual(JPEG_MAGIC);
  });
});
