/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageGrayscaleTask (cpu)", () => {
  test("converts RGBA pixel to 4-channel grayscale with replicated luma", async () => {
    const data = new Uint8ClampedArray([200, 100, 50, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "grayscale", undefined);
    const bin = (out as CpuImage).getBinary();
    // BT.601-style: (200*77 + 100*150 + 50*29) >> 8 = (15400 + 15000 + 1450) >> 8 = 31850 >> 8 = 124
    expect(bin.channels).toBe(4);
    expect(Array.from(bin.data.slice(0, 4))).toEqual([124, 124, 124, 255]);
  });
});
