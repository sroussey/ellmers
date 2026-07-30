/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/tf-mediapipe/ai";
import { describe, expect, it } from "vitest";

const { resolveTfmpDelegate } = _testOnly;

describe("resolveTfmpDelegate", () => {
  it("defaults vision to GPU", () => {
    expect(resolveTfmpDelegate("vision", undefined)).toBe("GPU");
    expect(resolveTfmpDelegate("vision", true)).toBe("GPU");
  });

  it("respects explicit gpu=false for vision", () => {
    expect(resolveTfmpDelegate("vision", false)).toBe("CPU");
  });

  it("never sets a delegate for CPU-only engines", () => {
    for (const engine of ["text", "audio"]) {
      expect(resolveTfmpDelegate(engine, true)).toBeUndefined();
      expect(resolveTfmpDelegate(engine, false)).toBeUndefined();
      expect(resolveTfmpDelegate(engine, undefined)).toBeUndefined();
    }
  });

  it("leaves genai to the genai runtime", () => {
    expect(resolveTfmpDelegate("genai", true)).toBeUndefined();
    expect(resolveTfmpDelegate("genai", false)).toBeUndefined();
  });
});
