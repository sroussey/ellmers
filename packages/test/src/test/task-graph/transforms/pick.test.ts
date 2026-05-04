/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { pickTransform } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

describe("pick transform", () => {
  it("applies a top-level path", async () => {
    expect(await pickTransform.apply({ a: 1, b: 2 }, { path: "a" })).toBe(1);
  });

  it("applies a dotted path", async () => {
    expect(await pickTransform.apply({ user: { id: 42 } }, { path: "user.id" })).toBe(42);
  });

  it("returns undefined when path is missing", async () => {
    expect(await pickTransform.apply({ a: 1 }, { path: "b" })).toBeUndefined();
  });

  it("inferOutputSchema returns the sub-schema at the path", () => {
    const input: DataPortSchema = {
      type: "object",
      properties: {
        created_at: { type: "number" },
        name: { type: "string" },
      },
    };
    const out = pickTransform.inferOutputSchema(input, { path: "created_at" });
    expect(out).toEqual({ type: "number" });
  });

  it("inferOutputSchema falls back to {} when path not resolvable statically", () => {
    const input: DataPortSchema = { type: "object", properties: {} } as DataPortSchema; // no properties
    const out = pickTransform.inferOutputSchema(input, { path: "created_at" });
    expect(out).toEqual({});
  });

  it("suggestFromSchemas returns a candidate when a property's schema matches target", () => {
    const source: DataPortSchema = {
      type: "object",
      properties: { created_at: { type: "number" } },
    };
    const target: DataPortSchema = { type: "number" } as DataPortSchema;
    const res = pickTransform.suggestFromSchemas!(source, target);
    expect(res).toEqual({ score: 1.0, params: { path: "created_at" } });
  });

  it("suggestFromSchemas returns undefined when no property matches", () => {
    const source: DataPortSchema = { type: "object", properties: { name: { type: "string" } } };
    const target: DataPortSchema = { type: "number" } as DataPortSchema;
    expect(pickTransform.suggestFromSchemas!(source, target)).toBeUndefined();
  });
});
