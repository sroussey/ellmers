/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageBorderTask (cpu)", () => {
  test("border width=1 color=#ff0000 on 1x1 black: output is 3x3, center is black, corner is red", async () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "border", { borderWidth: 1, color: "#ff0000" });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(3);
    expect(bin.height).toBe(3);
    // Corner pixel (0,0) is red
    expect(bin.data[0]).toBe(255);
    expect(bin.data[1]).toBe(0);
    expect(bin.data[2]).toBe(0);
    // Center pixel (1,1) is black
    const centerIdx = (1 * 3 + 1) * 4;
    expect(bin.data[centerIdx]).toBe(0);
    expect(bin.data[centerIdx + 1]).toBe(0);
    expect(bin.data[centerIdx + 2]).toBe(0);
  });

  test("border preserves dimensions correctly", async () => {
    const data = new Uint8ClampedArray(4 * 4 * 3).fill(128);
    const image = CpuImage.fromRaw({ data, width: 4, height: 4, channels: 3 });
        const out = applyFilter(image, "border", { borderWidth: 2, color: "#000000" });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(8);
    expect(bin.height).toBe(8);
    expect(bin.channels).toBe(4);
  });

  test("border with color object works", async () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
    const out = applyFilter(image, "border", { borderWidth: 1, color: { r: 0, g: 255, b: 0 } });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(3);
    expect(bin.height).toBe(3);
    // Corner should be green
    expect(bin.data[0]).toBe(0);
    expect(bin.data[1]).toBe(255);
    expect(bin.data[2]).toBe(0);
  });
});
