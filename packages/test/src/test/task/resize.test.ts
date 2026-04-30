/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageResizeTask (cpu)", () => {
  test("resize 1x1 white to 2x2 produces all-white output", async () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "resize", { width: 2, height: 2 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(2);
    expect(bin.height).toBe(2);
    expect(bin.data[0]).toBe(255);
    expect(bin.data[4]).toBe(255);
    expect(bin.data[8]).toBe(255);
    expect(bin.data[12]).toBe(255);
  });

  test("upscales dimensions correctly", async () => {
    const data = new Uint8ClampedArray(2 * 2 * 3).fill(100);
    const image = CpuImage.fromRaw({ data, width: 2, height: 2, channels: 3 });
        const out = applyFilter(image, "resize", { width: 4, height: 4 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(4);
    expect(bin.height).toBe(4);
    expect(bin.channels).toBe(3);
  });

  test("downscales dimensions correctly", async () => {
    const data = new Uint8ClampedArray(4 * 4 * 1).fill(50);
    const image = CpuImage.fromRaw({ data, width: 4, height: 4, channels: 1 });
        const out = applyFilter(image, "resize", { width: 2, height: 2 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(2);
    expect(bin.height).toBe(2);
    expect(bin.channels).toBe(1);
  });
});
