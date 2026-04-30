/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  type ImageValue,
  imageValueFromBuffer,
  previewSource,
  registerPreviewResizeFn,
  setPreviewBudget,
} from "@workglow/util/media";

const ORIGINAL_BUDGET = 512;

describe("previewSource (ImageValue)", () => {
  beforeEach(() => {
    setPreviewBudget(ORIGINAL_BUDGET);
    registerPreviewResizeFn(undefined);
  });
  afterEach(() => {
    setPreviewBudget(ORIGINAL_BUDGET);
    registerPreviewResizeFn(undefined);
  });

  test("returns the input unchanged when within budget", async () => {
    const v = imageValueFromBuffer(Buffer.alloc(0), "raw-rgba", 100, 100);
    const out = await previewSource(v);
    expect(out).toBe(v);
  });

  test("calls the registered resize fn when over budget and composes previewScale", async () => {
    let captured: { value: ImageValue; w: number; h: number } | undefined;
    const stub: ImageValue = imageValueFromBuffer(Buffer.alloc(0), "raw-rgba", 256, 256, 0.25);
    registerPreviewResizeFn(async (value, w, h) => {
      captured = { value, w, h };
      return stub;
    });
    const big = imageValueFromBuffer(Buffer.alloc(0), "raw-rgba", 2048, 1024);
    const out = await previewSource(big);
    expect(captured?.w).toBe(512);
    expect(captured?.h).toBe(256);
    expect(out.previewScale).toBeCloseTo(0.25, 5);
  });

  test("composes previewScale across two passes (idempotent on already-small)", async () => {
    let calls = 0;
    registerPreviewResizeFn(async (_v, w, h) => {
      calls++;
      return imageValueFromBuffer(Buffer.alloc(0), "raw-rgba", w, h, w / 2048);
    });
    const big = imageValueFromBuffer(Buffer.alloc(0), "raw-rgba", 2048, 1024);
    const once = await previewSource(big);
    const twice = await previewSource(once);
    expect(calls).toBe(1);
    expect(twice).toBe(once);
  });
});
