/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";

import { applyFilter } from "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

describe("ImageTintTask (cpu)", () => {
  test("amount 0 is identity", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "tint", { color: "#ff0000", amount: 0 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBe(100);
    expect(bin.data[1]).toBe(150);
    expect(bin.data[2]).toBe(200);
    expect(bin.data[3]).toBe(255);
  });

  test("green tint at 0.5 on white pixel", async () => {
    // color="#00ff00" → r=0,g=255,b=0; amount=0.5; invAmount=0.5
    // r = 255*0.5 + 0*0.5 = 127.5 → 128 (Uint8ClampedArray rounds)
    // g = 255*0.5 + 255*0.5 = 255
    // b = 255*0.5 + 0*0.5 = 127.5 → 128
    const data = new Uint8ClampedArray([255, 255, 255, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "tint", { color: "#00ff00", amount: 0.5 });
    const bin = (out as CpuImage).getBinary();
    // Uint8ClampedArray rounds 127.5 to 128
    expect(bin.data[0]).toBe(128);
    expect(bin.data[1]).toBe(255);
    expect(bin.data[2]).toBe(128);
    expect(bin.data[3]).toBe(255);
  });

  test("amount 1 produces tint color", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromRaw({ data, width: 1, height: 1, channels: 4 });
        const out = applyFilter(image, "tint", { color: "#ff0000", amount: 1 });
    const bin = (out as CpuImage).getBinary();
    expect(bin.data[0]).toBe(255);
    expect(bin.data[1]).toBe(0);
    expect(bin.data[2]).toBe(0);
    expect(bin.data[3]).toBe(255);
  });
});
