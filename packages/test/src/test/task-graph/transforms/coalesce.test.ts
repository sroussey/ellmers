/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { coalesceTransform } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("coalesce", () => {
  it("returns input when non-null", async () => {
    expect(await coalesceTransform.apply(42, { defaultValue: 0 })).toBe(42);
  });
  it("returns default when null", async () => {
    expect(await coalesceTransform.apply(null, { defaultValue: 0 })).toBe(0);
  });
  it("returns default when undefined", async () => {
    expect(await coalesceTransform.apply(undefined, { defaultValue: "x" })).toBe("x");
  });
  it("inferOutputSchema strips nullability", () => {
    const out = coalesceTransform.inferOutputSchema({ type: ["string", "null"] } as any, {
      defaultValue: "",
    });
    expect(out).toEqual({ type: "string" });
  });
});
