/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageThresholdTask (cpu)", () => {
  test("channel >= threshold becomes 255", async () => {
    const data = new Uint8ClampedArray([200, 50, 128, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "threshold", { value: 128 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBe(255);
    expect(bin.data[1]).toBe(0);
    expect(bin.data[2]).toBe(255);
    expect(bin.data[3]).toBe(255);
  });

  test("preserves channels count", async () => {
    const data = new Uint8ClampedArray([200, 50, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 3 });
        const out = applyFilter(image, "threshold", { value: 128 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.channels).toBe(3);
    expect(bin.data[0]).toBe(255);
    expect(bin.data[1]).toBe(0);
    expect(bin.data[2]).toBe(255);
  });
});
