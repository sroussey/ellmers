/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageContrastTask (cpu)", () => {
  test("zero amount is identity", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "contrast", { amount: 0 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBe(100);
    expect(bin.data[1]).toBe(150);
    expect(bin.data[2]).toBe(200);
    expect(bin.data[3]).toBe(255);
  });

  test("positive contrast pushes values away from 128", async () => {
    // factor = (259*(10+255))/(255*(259-10)) = 68635/63495 ≈ 1.0809
    // lut[100] = 1.0809*(100-128)+128 ≈ 97.73 → 97
    // lut[150] = 1.0809*(150-128)+128 ≈ 151.78 → 151
    const data = new Uint8ClampedArray([100, 150, 128, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "contrast", { amount: 10 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBeLessThan(100);
    expect(bin.data[1]).toBeGreaterThan(150);
    expect(bin.data[2]).toBe(128);
    expect(bin.data[3]).toBe(255);
  });
});
