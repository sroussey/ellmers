/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import "@workglow/tasks";
import {
  ImageBlurTask,
  ImageBorderTask,
  ImageCropTask,
  ImagePixelateTask,
  ImageResizeTask,
} from "@workglow/tasks";
import { describe, expect, test } from "vitest";

// Each test exercises the override directly via a casting trampoline. We avoid
// running the full task pipeline — these are pure parameter-scaling unit tests.
function callScale(task: object, params: unknown, scale: number): unknown {
  return (
    task as unknown as { scalePreviewParams(p: unknown, s: number): unknown }
  ).scalePreviewParams(params, scale);
}

describe("scalePreviewParams overrides", () => {
  test("ImageBlurTask scales radius", () => {
    const t = new ImageBlurTask();
    expect(callScale(t, { radius: 10 }, 1.0)).toEqual({ radius: 10 });
    expect(callScale(t, { radius: 10 }, 0.2)).toEqual({ radius: 2 });
    expect(callScale(t, { radius: 1 }, 0.05)).toEqual({ radius: 1 }); // floor to 1
  });

  test("ImagePixelateTask scales blockSize", () => {
    const t = new ImagePixelateTask();
    expect(callScale(t, { blockSize: 64 }, 1.0)).toEqual({ blockSize: 64 });
    expect(callScale(t, { blockSize: 64 }, 0.2)).toEqual({ blockSize: 13 });
    expect(callScale(t, { blockSize: 2 }, 0.1)).toEqual({ blockSize: 1 }); // floor to 1
  });

  test("ImageBorderTask scales borderWidth, color passes through", () => {
    const t = new ImageBorderTask();
    expect(callScale(t, { borderWidth: 20, color: "#ff0000" }, 1.0)).toEqual({
      borderWidth: 20,
      color: "#ff0000",
    });
    expect(callScale(t, { borderWidth: 20, color: "#ff0000" }, 0.25)).toEqual({
      borderWidth: 5,
      color: "#ff0000",
    });
  });

  test("ImageCropTask scales left/top/width/height", () => {
    const t = new ImageCropTask();
    expect(callScale(t, { left: 100, top: 50, width: 200, height: 150 }, 1.0)).toEqual({
      left: 100,
      top: 50,
      width: 200,
      height: 150,
    });
    expect(callScale(t, { left: 100, top: 50, width: 200, height: 150 }, 0.5)).toEqual({
      left: 50,
      top: 25,
      width: 100,
      height: 75,
    });
  });

  test("ImageResizeTask scales target width/height with min-1 floor", () => {
    const t = new ImageResizeTask();
    expect(callScale(t, { width: 1024, height: 768 }, 1.0)).toEqual({ width: 1024, height: 768 });
    expect(callScale(t, { width: 1024, height: 768 }, 0.2)).toEqual({ width: 205, height: 154 });
  });
});
