/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import "@workglow/tasks";
import "@workglow/util/media";

import {
  ImageBlurTask,
  ImageBorderTask,
  ImageFlipTask,
  ImagePixelateTask,
  ImagePosterizeTask,
  ImageSepiaTask,
  ImageTextTask,
} from "@workglow/tasks";
import { CpuImage, imageValueFromBuffer, type ImageValue } from "@workglow/util/media";
import { describe, expect, test } from "vitest";

async function runChain(start: ImageValue): Promise<ImageValue> {
  let img = start;
  img = (await new ImageTextTask().executePreview(
    {
      image: img,
      text: "GO",
      font: "sans-serif",
      fontSize: 12,
      bold: false,
      italic: false,
      color: "#ffffff",
      position: "middle-center",
    } as never,
    {} as never,
  ))!.image as ImageValue;
  img = (await new ImageFlipTask().executePreview(
    { image: img, direction: "horizontal" } as never,
    {} as never,
  ))!.image as ImageValue;
  img = (await new ImageSepiaTask().executePreview({ image: img } as never, {} as never))!
    .image as ImageValue;
  img = (await new ImageBlurTask().executePreview({ image: img, radius: 1 } as never, {} as never))!
    .image as ImageValue;
  img = (await new ImagePosterizeTask().executePreview(
    { image: img, levels: 4 } as never,
    {} as never,
  ))!.image as ImageValue;
  img = (await new ImageBorderTask().executePreview(
    { image: img, borderWidth: 2, color: "#000000" } as never,
    {} as never,
  ))!.image as ImageValue;
  img = (await new ImagePixelateTask().executePreview(
    { image: img, blockSize: 2 } as never,
    {} as never,
  ))!.image as ImageValue;
  return img;
}

describe("7-stage chain integration (CPU)", () => {
  test("chain runs without error and produces deterministic dimensions", async () => {
    const data = new Uint8ClampedArray(64 * 64 * 4).fill(100);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const start = imageValueFromBuffer(buf, "raw-rgba", 64, 64);
    const end = await runChain(start);
    expect(end.width).toBeGreaterThan(0);
    expect(end.height).toBeGreaterThan(0);
    // Smoke test: read pixels back and confirm non-empty content.
    const cpu = await CpuImage.from(end);
    const out = cpu.getBinary();
    let nonZero = 0;
    for (let i = 0; i < out.data.length; i++) if (out.data[i]! > 0) nonZero++;
    expect(nonZero).toBeGreaterThan(out.data.length / 4);
  });
});
