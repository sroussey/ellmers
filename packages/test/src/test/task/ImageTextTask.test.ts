/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/tasks";
import { ImageTextTask } from "@workglow/tasks";
import {
  getPreviewBudget,
  imageValueFromBuffer,
  setPreviewBudget,
  type ImageValue,
} from "@workglow/util/media";

function rawValue(data: Uint8ClampedArray, w: number, h: number, previewScale = 1.0): ImageValue {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return imageValueFromBuffer(buf, "raw-rgba", w, h, previewScale);
}

describe("ImageTextTask preview-scale behavior", () => {
  test("with background image: scales fontSize by background.previewScale", async () => {
    // Construct an ImageValue with previewScale=0.25 as the background.
    const bg = rawValue(new Uint8ClampedArray(4 * 100 * 100), 100, 100, 0.25);
    const task = new ImageTextTask({ id: "tx1" });
    const out = await task.executePreview(
      { text: "Hello", color: "#ffffff", fontSize: 24, image: bg } as never,
      {} as never,
    );
    // Output is an ImageValue carrying the same scale as the background.
    expect(out!.image.previewScale).toBe(0.25);
    // Sanity: dims equal background dims (text rendered at scaled fontSize OVER the bg).
    expect(out!.image.width).toBe(100);
    expect(out!.image.height).toBe(100);
  });

  test("without background, dims under budget: scale stays 1.0", async () => {
    const originalBudget = getPreviewBudget();
    setPreviewBudget(1000);
    try {
      const task = new ImageTextTask({ id: "tx2" });
      const out = await task.executePreview(
        { text: "Hi", color: "#000000", fontSize: 24, width: 200, height: 100 } as never,
        {} as never,
      );
      expect(out!.image.previewScale).toBe(1.0);
      expect(out!.image.width).toBe(200);
      expect(out!.image.height).toBe(100);
    } finally {
      setPreviewBudget(originalBudget);
    }
  });

  test("without background, dims over budget: applies budget at source", async () => {
    const originalBudget = getPreviewBudget();
    setPreviewBudget(100);
    try {
      const task = new ImageTextTask({ id: "tx3" });
      const out = await task.executePreview(
        { text: "Hi", color: "#000000", fontSize: 40, width: 500, height: 250 } as never,
        {} as never,
      );
      // Long edge is 500; scale = 100/500 = 0.2.
      // Output dims are scaled: 500*0.2=100, 250*0.2=50.
      expect(out!.image.width).toBe(100);
      expect(out!.image.height).toBe(50);
      expect(out!.image.previewScale).toBeCloseTo(0.2, 5);
    } finally {
      setPreviewBudget(originalBudget);
    }
  });
});
