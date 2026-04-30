/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, test } from "vitest";
import { isImageValue, normalizeToImageValue } from "@workglow/util/media";

describe("imageHydrationResolver", () => {
  test("normalizeToImageValue passes through ImageValue", async () => {
    const v = {
      buffer: Buffer.alloc(0),
      format: "raw-rgba" as const,
      width: 1,
      height: 1,
      previewScale: 1.0,
    };
    expect(isImageValue(v)).toBe(true);
    expect(await normalizeToImageValue(v)).toBe(v);
  });

  test("returns undefined on unrecognized shapes", async () => {
    expect(await normalizeToImageValue({ width: 1 })).toBeUndefined();
  });
});
