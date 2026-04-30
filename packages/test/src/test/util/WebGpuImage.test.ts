/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test, beforeEach } from "vitest";
import {
  getGpuDevice,
  imageValueFromBitmap,
  PASSTHROUGH_SHADER_SRC,
  resetGpuDeviceForTests,
  resetTexturePoolForTests,
  type ApplyParams,
  type WebGpuImage as WebGpuImageType,
} from "@workglow/util/media";

const isBrowser = typeof window !== "undefined";

// WebGpuImage is browser-only at runtime; dynamic import resolves correctly
// in browser context. In node, only the type is available.
async function getWebGpuImage(): Promise<typeof WebGpuImageType> {
  const media = await import("@workglow/util/media");
  return (media as unknown as { WebGpuImage: typeof WebGpuImageType }).WebGpuImage;
}

describe("WebGpuImage (API surface)", () => {
  test.skipIf(!isBrowser)("module exports WebGpuImage class in browser", async () => {
    const WebGpuImage = await getWebGpuImage();
    expect(typeof WebGpuImage).toBe("function");
    // The new boundary entry is `from(value)`; refcount/fromImageBinary are gone.
    expect(typeof WebGpuImage.from).toBe("function");
  });

  test("ApplyParams type is structurally exported (compile-time)", () => {
    const p: ApplyParams = { shader: PASSTHROUGH_SHADER_SRC, uniforms: undefined };
    expect(p.shader).toBe(PASSTHROUGH_SHADER_SRC);
  });
});

describe.skipIf(typeof navigator === "undefined" || !("gpu" in navigator))(
  "WebGpuImage (browser)",
  () => {
    beforeEach(() => {
      resetGpuDeviceForTests();
      resetTexturePoolForTests();
    });

    test("from(BrowserImageValue) yields a backed image; transferToImageBitmap drains it", async () => {
      const WebGpuImage = await getWebGpuImage();
      const dev = await getGpuDevice();
      if (!dev) return;
      // Build a 2x2 bitmap from raw pixels via OffscreenCanvas+ImageData.
      const data = new Uint8ClampedArray([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 0, 255,
      ]);
      const off = new OffscreenCanvas(2, 2);
      const ctx = off.getContext("2d")!;
      ctx.putImageData(new ImageData(data, 2, 2), 0, 0);
      const bitmap = await createImageBitmap(off);
      const value = imageValueFromBitmap(bitmap, 2, 2);

      const img = await WebGpuImage.from(value);
      expect(img.backend).toBe("webgpu");
      // transferToImageBitmap is the boundary egress for browser; it disposes the source.
      const out = await img.transferToImageBitmap();
      expect(out.width).toBe(2);
      expect(out.height).toBe(2);
    });

    test("apply(passthrough) returns a new texture without disturbing the source", async () => {
      const WebGpuImage = await getWebGpuImage();
      const dev = await getGpuDevice();
      if (!dev) return;
      const off = new OffscreenCanvas(1, 1);
      const ctx = off.getContext("2d")!;
      ctx.putImageData(new ImageData(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1), 0, 0);
      const bitmap = await createImageBitmap(off);
      const value = imageValueFromBitmap(bitmap, 1, 1);

      const img = await WebGpuImage.from(value);
      const out = img.apply({ shader: PASSTHROUGH_SHADER_SRC, uniforms: undefined });
      expect(out).not.toBe(img);
      // Both can still produce bitmaps because each owns its own texture.
      const outBitmap = await out.transferToImageBitmap();
      expect(outBitmap.width).toBe(1);
      // The source still has its texture; dispose() to release.
      img.dispose();
    });

    test("encode('png') returns PNG-magic bytes", async () => {
      const WebGpuImage = await getWebGpuImage();
      const dev = await getGpuDevice();
      if (!dev) return;
      const data = new Uint8ClampedArray(2 * 2 * 4).fill(128);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      const off = new OffscreenCanvas(2, 2);
      const ctx = off.getContext("2d")!;
      ctx.putImageData(new ImageData(data, 2, 2), 0, 0);
      const bitmap = await createImageBitmap(off);
      const value = imageValueFromBitmap(bitmap, 2, 2);
      const img = await WebGpuImage.from(value);
      const bytes = await img.encode("png");
      expect(bytes[0]).toBe(0x89);
      expect(bytes[1]).toBe(0x50);
    });
  },
);
