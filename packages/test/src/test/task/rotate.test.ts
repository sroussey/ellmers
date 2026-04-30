/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageRotateTask (cpu)", () => {
  test("rotate 180 on 2x1 image: green is now top-left, red is now right", async () => {
    // 2x1 image: pixel[0]=(255,0,0,255) red, pixel[1]=(0,255,0,255) green
    const data = new Uint8ClampedArray([255, 0, 0, 255,  0, 255, 0, 255]);
    const image = CpuImage.fromRaw({ data, width: 2, height: 1, channels: 4 });
        const out = applyFilter(image, "rotate", { angle: 180 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(2);
    expect(bin.height).toBe(1);
    // After 180 rotation: top-left is now green
    expect(bin.data[0]).toBe(0);
    expect(bin.data[1]).toBe(255);
    expect(bin.data[2]).toBe(0);
    // Right pixel is red
    expect(bin.data[4]).toBe(255);
    expect(bin.data[5]).toBe(0);
    expect(bin.data[6]).toBe(0);
  });

  test("rotate 90 swaps width and height", async () => {
    const data = new Uint8ClampedArray(2 * 3 * 1).fill(0);
    for (let i = 0; i < 6; i++) data[i] = i * 40;
    const image = CpuImage.fromRaw({ data, width: 2, height: 3, channels: 1 });
        const out = applyFilter(image, "rotate", { angle: 90 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(3);
    expect(bin.height).toBe(2);
  });

  test("rotate 270 swaps width and height", async () => {
    const data = new Uint8ClampedArray(2 * 3 * 1).fill(0);
    const image = CpuImage.fromRaw({ data, width: 2, height: 3, channels: 1 });
        const out = applyFilter(image, "rotate", { angle: 270 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(3);
    expect(bin.height).toBe(2);
  });

  test("rotate 180 preserves dimensions", async () => {
    const data = new Uint8ClampedArray(3 * 4 * 1);
    for (let i = 0; i < 12; i++) data[i] = i * 20;
    const image = CpuImage.fromRaw({ data, width: 3, height: 4, channels: 1 });
        const out = applyFilter(image, "rotate", { angle: 180 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.width).toBe(3);
    expect(bin.height).toBe(4);
    expect(bin.data[11]).toBe(0);
    expect(bin.data[0]).toBe(data[11]);
  });
});
