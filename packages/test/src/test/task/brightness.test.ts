/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageBrightnessTask (cpu)", () => {
  test("adds amount to each RGB channel", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "brightness", { amount: 20 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBe(120);
    expect(bin.data[1]).toBe(170);
    expect(bin.data[2]).toBe(220);
    expect(bin.data[3]).toBe(255);
  });

  test("clamps at 255", async () => {
    const data = new Uint8ClampedArray([250, 250, 250, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "brightness", { amount: 20 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBe(255);
    expect(bin.data[1]).toBe(255);
    expect(bin.data[2]).toBe(255);
    expect(bin.data[3]).toBe(255);
  });

  test("clamps at 0", async () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "brightness", { amount: -50 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBe(0);
    expect(bin.data[1]).toBe(0);
    expect(bin.data[2]).toBe(0);
    expect(bin.data[3]).toBe(255);
  });
});
