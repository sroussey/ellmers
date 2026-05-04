/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { indexTransform } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

describe("index transform", () => {
  it("applies a positive index", async () => {
    expect(await indexTransform.apply([10, 20, 30], { index: 1 })).toBe(20);
  });

  it("applies a negative index (from end)", async () => {
    expect(await indexTransform.apply([10, 20, 30], { index: -1 })).toBe(30);
  });

  it("returns undefined on out-of-range", async () => {
    expect(await indexTransform.apply([10], { index: 5 })).toBeUndefined();
  });

  it("returns undefined on non-array", async () => {
    expect(await indexTransform.apply(null, { index: 0 })).toBeUndefined();
  });

  it("inferOutputSchema returns the item schema", () => {
    const input: DataPortSchema = { type: "array", items: { type: "number" } } as DataPortSchema;
    expect(indexTransform.inferOutputSchema(input, { index: 0 })).toEqual({ type: "number" });
  });

  it("suggestFromSchemas returns a candidate when item schema matches target", () => {
    const source: DataPortSchema = { type: "array", items: { type: "string" } } as DataPortSchema;
    const target: DataPortSchema = { type: "string" } as DataPortSchema;
    const res = indexTransform.suggestFromSchemas!(source, target);
    expect(res).toEqual({ score: 0.9, params: { index: 0 } });
  });
});
