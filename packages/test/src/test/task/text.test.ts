/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/tasks";
import { ImageTextTask } from "@workglow/tasks";
import { CpuImage, imageValueFromBuffer, type ImageValue } from "@workglow/util/media";

function rawValue(data: Uint8ClampedArray, w: number, h: number): ImageValue {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return imageValueFromBuffer(buf, "raw-rgba", w, h);
}

async function readPixels(value: ImageValue): Promise<Uint8ClampedArray> {
  const cpu = await CpuImage.from(value);
  return cpu.getBinary().data;
}

describe("ImageTextTask (cpu)", () => {
  test("renders text onto a transparent background of the given dimensions", async () => {
    const t = new ImageTextTask();
    const out = await t.execute(
      {
        text: "AB",
        width: 32,
        height: 16,
        font: "sans-serif",
        fontSize: 12,
        bold: false,
        italic: false,
        color: "#ffffff",
        position: "middle-center",
      } as never,
      {} as never,
    );
    expect(out).toBeDefined();
    expect(out!.image.width).toBe(32);
    expect(out!.image.height).toBe(16);
    const data = await readPixels(out!.image);
    let hasText = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! > 0) {
        hasText = true;
        break;
      }
    }
    expect(hasText).toBe(true);
  });

  test("composites text over a background image", async () => {
    const bgData = new Uint8ClampedArray(32 * 16 * 4);
    for (let i = 0; i < bgData.length; i += 4) {
      bgData[i] = 100;
      bgData[i + 1] = 100;
      bgData[i + 2] = 100;
      bgData[i + 3] = 255;
    }
    const bg = rawValue(bgData, 32, 16);
    const t = new ImageTextTask();
    const out = await t.execute(
      {
        image: bg,
        text: "AB",
        font: "sans-serif",
        fontSize: 12,
        bold: false,
        italic: false,
        color: "#ffffff",
        position: "middle-center",
      } as never,
      {} as never,
    );
    expect(out).toBeDefined();
    expect(out!.image.width).toBe(32);
    expect(out!.image.height).toBe(16);
  });
});
