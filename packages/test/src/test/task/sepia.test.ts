/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageSepiaTask (cpu)", () => {
  test("applies sepia coefficients to RGBA pixel", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "sepia", undefined);
    const bin = (out as CpuImage).getBinary();
    // r = (100*402 + 150*787 + 200*194) >> 10 = (40200 + 118050 + 38800) >> 10 = 197050 >> 10 = 192
    // g = (100*357 + 150*702 + 200*172) >> 10 = (35700 + 105300 + 34400) >> 10 = 175400 >> 10 = 171
    // b = (100*279 + 150*547 + 200*134) >> 10 = (27900 + 82050 + 26800) >> 10 = 136750 >> 10 = 133
    expect(bin.data[0]).toBeGreaterThanOrEqual(190);
    expect(bin.data[0]).toBeLessThanOrEqual(194);
    expect(bin.data[1]).toBeGreaterThanOrEqual(169);
    expect(bin.data[1]).toBeLessThanOrEqual(173);
    expect(bin.data[2]).toBeGreaterThanOrEqual(131);
    expect(bin.data[2]).toBeLessThanOrEqual(135);
    expect(bin.data[3]).toBe(255);
  });
});
