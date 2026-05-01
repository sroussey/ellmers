/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageInvertTask (cpu)", () => {
  test("inverts RGB channels and preserves alpha", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "invert", undefined);
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBe(155);
    expect(bin.data[1]).toBe(105);
    expect(bin.data[2]).toBe(55);
    expect(bin.data[3]).toBe(255);
  });
});
