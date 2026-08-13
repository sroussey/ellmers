/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { MODEL_EFFORTS, isModelEffort } from "../ModelEffort";

describe("ModelEffort", () => {
  it("lists none through ultra", () => {
    expect([...MODEL_EFFORTS]).toEqual(["none", "low", "medium", "high", "extra", "ultra"]);
  });

  it("isModelEffort accepts only known values", () => {
    expect(isModelEffort("high")).toBe(true);
    expect(isModelEffort("off")).toBe(false);
    expect(isModelEffort("xhigh")).toBe(false);
    expect(isModelEffort(undefined)).toBe(false);
  });
});
