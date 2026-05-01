/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from "vitest";
import {
  imageValueFromBuffer,
  isBrowserImageValue,
  isImageValue,
  isNodeImageValue,
  normalizeToImageValue,
} from "./imageValue";

describe("imageValue", () => {
  test("imageValueFromBuffer creates a NodeImageValue with default previewScale 1.0", () => {
    const buf = Buffer.from(new Uint8Array([1, 2, 3, 4]));
    const v = imageValueFromBuffer(buf, "raw-rgba", 1, 1);
    expect(v.buffer).toBe(buf);
    expect(v.format).toBe("raw-rgba");
    expect(v.width).toBe(1);
    expect(v.height).toBe(1);
    expect(v.previewScale).toBe(1.0);
  });

  test("imageValueFromBuffer accepts an explicit previewScale", () => {
    const buf = Buffer.alloc(0);
    const v = imageValueFromBuffer(buf, "png", 100, 50, 0.5);
    expect(v.previewScale).toBe(0.5);
  });

  test("isImageValue accepts node and browser shapes, rejects others", () => {
    const node = imageValueFromBuffer(Buffer.alloc(0), "png", 1, 1);
    expect(isImageValue(node)).toBe(true);
    expect(isNodeImageValue(node)).toBe(true);
    expect(isBrowserImageValue(node)).toBe(false);
    expect(isImageValue({ width: 1, height: 1 })).toBe(false);
    expect(isImageValue(null)).toBe(false);
    expect(isImageValue("data:image/png;base64,xxx")).toBe(false);
  });
});

describe("normalizeToImageValue", () => {
  test("passes through an already-normalized ImageValue unchanged", async () => {
    const original = imageValueFromBuffer(Buffer.from([1, 2, 3, 4]), "raw-rgba", 1, 1);
    const result = await normalizeToImageValue(original);
    expect(result).toBe(original);
  });

  test("returns undefined for unrecognized inputs (null, plain objects, numbers)", async () => {
    expect(await normalizeToImageValue(null)).toBeUndefined();
    expect(await normalizeToImageValue(undefined)).toBeUndefined();
    expect(await normalizeToImageValue(42)).toBeUndefined();
    expect(await normalizeToImageValue({ foo: "bar" })).toBeUndefined();
  });
});
