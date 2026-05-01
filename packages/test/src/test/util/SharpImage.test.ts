/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
// Import tasks to register the image raster codec (needed by CpuImage.from(png/jpeg)).
import "@workglow/tasks";
import { CpuImage, imageValueFromBuffer, SharpImage } from "@workglow/util/media";

// Skip in browser environments — sharp is server-only.
const isBrowser = typeof window !== "undefined";

/**
 * Build a NodeImageValue from raw RGBA bytes — the new boundary form
 * SharpImage.from() expects. Replaces the old `fromImageBinary` ergonomics
 * the previous test suite relied on.
 */
function rawValue(data: Uint8ClampedArray, width: number, height: number) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return imageValueFromBuffer(buf, "raw-rgba", width, height);
}

describe.skipIf(isBrowser)("SharpImage", () => {
  test("backend tag is 'sharp'", async () => {
    const img = await SharpImage.from(rawValue(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1));
    expect(img.backend).toBe("sharp");
  });

  test("from(NodeImageValue) -> toImageValue round-trips dimensions", async () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 128, 128, 128, 255,
    ]);
    const img = await SharpImage.from(rawValue(data, 2, 2));
    const out = await img.toImageValue(1.0);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.previewScale).toBe(1.0);
  });

  test("encode('png') returns PNG-magic bytes", async () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const img = await SharpImage.from(rawValue(data, 4, 4));
    const png = await img.encode("png");
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  test("apply forks the pipeline; original still produces a value", async () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const img = await SharpImage.from(rawValue(data, 1, 1));
    const flipped = img.apply((p) => p.flip());
    expect(flipped).not.toBe(img);
    // Both pipelines should be usable independently after `apply`. Each
    // toImageValue() consumes its own clone.
    const origVal = await img.toImageValue(1.0);
    expect(origVal.width).toBe(1);
    const flipVal = await flipped.toImageValue(1.0);
    expect(flipVal.width).toBe(1);
  });

  test("dispose() does not throw and clears the pipeline", async () => {
    const img = await SharpImage.from(
      rawValue(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1),
    );
    expect(() => img.dispose()).not.toThrow();
    // Subsequent ops on the disposed instance fail loudly.
    await expect(img.encode("png")).rejects.toThrow(/disposed/);
  });

  test("from() rejects BrowserImageValue at runtime", async () => {
    // Construct a plausible browser value shape via a raw object literal —
    // we can't actually create an ImageBitmap in Node, but the error path
    // is reached by the type-discrimination guard before any bitmap usage.
    const fakeBrowserValue = {
      bitmap: {} as unknown,
      width: 1,
      height: 1,
      previewScale: 1,
    };
    await expect(SharpImage.from(fakeBrowserValue as never)).rejects.toThrow();
  });

  test("CpuImage.from(NodeImageValue with 'png' format) decodes via the codec", async () => {
    // Round-trip: encode RGBA via SharpImage -> NodeImageValue with format "png",
    // then decode through CpuImage.from to verify the codec wiring is live.
    const data = new Uint8ClampedArray([12, 34, 56, 255]);
    const img = await SharpImage.from(rawValue(data, 1, 1));
    const value = await img.toImageValue(1.0); // produces format=png NodeImageValue
    const cpu = await CpuImage.from(value);
    const bin = cpu.getBinary();
    expect(bin.width).toBe(1);
    expect(bin.height).toBe(1);
  });
});
