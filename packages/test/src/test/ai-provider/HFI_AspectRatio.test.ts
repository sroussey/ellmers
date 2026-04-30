/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { resolveHfImageDims, isHfInpaintingModel } from "@workglow/ai-provider/hf-inference";

describe("HFI aspect-ratio table", () => {
  it("Flux 1:1 → 1024x1024", () => {
    expect(resolveHfImageDims("black-forest-labs/FLUX.1-schnell", "1:1")).toEqual({
      width: 1024,
      height: 1024,
    });
  });
  it("Flux 16:9 → 1344x768", () => {
    expect(resolveHfImageDims("black-forest-labs/FLUX.1-schnell", "16:9")).toEqual({
      width: 1344,
      height: 768,
    });
  });
  it("unknown model falls back to SDXL dims", () => {
    expect(resolveHfImageDims("foo/bar", "1:1")).toEqual({ width: 1024, height: 1024 });
  });
  it("Kontext is recognized as inpainting-capable", () => {
    expect(isHfInpaintingModel("black-forest-labs/FLUX.1-Kontext-dev")).toBe(true);
  });
  it("Flux schnell is not inpainting", () => {
    expect(isHfInpaintingModel("black-forest-labs/FLUX.1-schnell")).toBe(false);
  });
});
