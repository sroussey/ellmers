/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isoDateToUnixTransform, unixToIsoDateTransform } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

describe("unixToIsoDate", () => {
  it("converts seconds to ISO", async () => {
    expect(await unixToIsoDateTransform.apply(1700000000, { unit: "s" })).toBe(
      "2023-11-14T22:13:20.000Z"
    );
  });
  it("converts milliseconds to ISO", async () => {
    expect(await unixToIsoDateTransform.apply(1700000000000, { unit: "ms" })).toBe(
      "2023-11-14T22:13:20.000Z"
    );
  });
  it("inferOutputSchema returns date-time string", () => {
    const out = unixToIsoDateTransform.inferOutputSchema({ type: "number" } as DataPortSchema, {
      unit: "s",
    });
    expect(out).toEqual({ type: "string", format: "date-time" });
  });
  it("suggestFromSchemas suggests unit when target has format date-time", () => {
    const src: DataPortSchema = { type: "number" } as DataPortSchema;
    const tgt: DataPortSchema = { type: "string", format: "date-time" } as DataPortSchema;
    const res = unixToIsoDateTransform.suggestFromSchemas!(src, tgt);
    expect(res?.score).toBeGreaterThan(0.7);
    expect(["s", "ms"]).toContain(res?.params.unit);
  });
});

describe("isoDateToUnix", () => {
  it("converts ISO string to unix ms", async () => {
    expect(await isoDateToUnixTransform.apply("2023-11-14T22:13:20.000Z", {})).toBe(1700000000000);
  });
  it("inferOutputSchema returns number", () => {
    expect(
      isoDateToUnixTransform.inferOutputSchema({ type: "string" } as DataPortSchema, {})
    ).toEqual({
      type: "number",
    });
  });
});
