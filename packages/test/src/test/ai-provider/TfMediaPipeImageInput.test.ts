/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly as tfmp } from "@workglow/tf-mediapipe/ai";
import { describe, expect, it } from "vitest";

const { toTexImageSource } = tfmp;

class FakeImageBitmap {
  constructor(
    public readonly width: number,
    public readonly height: number
  ) {}
}

/** Stand in for the browser global so this runs under node. */
function withImageBitmap<T>(fn: () => T): T {
  const g = globalThis as { ImageBitmap?: unknown };
  const had = "ImageBitmap" in g;
  const prev = g.ImageBitmap;
  g.ImageBitmap = FakeImageBitmap;
  try {
    return fn();
  } finally {
    if (had) g.ImageBitmap = prev;
    else delete g.ImageBitmap;
  }
}

describe("toTexImageSource", () => {
  // MediaPipe hands its argument straight to texImage2D. A BrowserImageValue is a
  // wrapper around the bitmap, so passing it through unchanged fails deep inside
  // the SDK with "Overload resolution failed".
  it("unwraps a BrowserImageValue to its bitmap", () => {
    withImageBitmap(() => {
      const bitmap = new FakeImageBitmap(64, 48);
      const imageValue = { bitmap, width: 64, height: 48, previewScale: 1 };
      expect(toTexImageSource(imageValue)).toBe(bitmap);
    });
  });

  it("passes an already-unwrapped source through", () => {
    withImageBitmap(() => {
      const bitmap = new FakeImageBitmap(8, 8);
      expect(toTexImageSource(bitmap)).toBe(bitmap);
    });
  });

  it("rejects a NodeImageValue with an actionable message", () => {
    withImageBitmap(() => {
      const nodeValue = { buffer: new Uint8Array(4), format: "png", width: 1, height: 1, previewScale: 1 };
      expect(() => toTexImageSource(nodeValue)).toThrow(/browser-only/);
    });
  });

  it("rejects a missing image rather than reaching the SDK", () => {
    withImageBitmap(() => {
      expect(() => toTexImageSource(undefined)).toThrow(/image source/);
    });
  });
});
