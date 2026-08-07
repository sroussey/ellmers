/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mapPostgresType, TYPED_ARRAY_CTORS } from "@workglow/storage";
import type { JsonSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

// The real backends pass their null-stripping helper; for these schemas there
// is no nullable wrapper so an identity function is correct.
const options = { getNonNullType: (t: JsonSchema) => t };

describe("mapPostgresType integer range selection", () => {
  it("uses BIGINT for an unsigned maximum above INTEGER's range", () => {
    expect(mapPostgresType({ type: "integer", minimum: 0, maximum: 9999999999 }, options)).toBe(
      "BIGINT"
    );
  });

  it("uses BIGINT for a signed schema whose maximum exceeds INTEGER's range", () => {
    // Regression: a negative/absent minimum used to skip the maximum-based
    // range selection and fall through to INTEGER, overflowing at runtime.
    expect(mapPostgresType({ type: "integer", minimum: -1, maximum: 9999999999 }, options)).toBe(
      "BIGINT"
    );
  });

  it("uses BIGINT when only a large maximum is present (no minimum)", () => {
    expect(mapPostgresType({ type: "integer", maximum: 9999999999 }, options)).toBe("BIGINT");
  });

  it("uses BIGINT when the minimum is below INTEGER's lower bound", () => {
    expect(mapPostgresType({ type: "integer", minimum: -3000000000 }, options)).toBe("BIGINT");
  });

  it("keeps INTEGER for in-range signed schemas", () => {
    expect(mapPostgresType({ type: "integer", minimum: -100, maximum: 100 }, options)).toBe(
      "INTEGER"
    );
  });

  it("keeps SMALLINT / INTEGER for in-range unsigned schemas", () => {
    expect(mapPostgresType({ type: "integer", minimum: 0, maximum: 100 }, options)).toBe(
      "SMALLINT"
    );
    expect(mapPostgresType({ type: "integer", minimum: 0, maximum: 100000 }, options)).toBe(
      "INTEGER"
    );
  });
});

describe("TYPED_ARRAY_CTORS", () => {
  it("includes Float16Array so documented quantized vectors decode", () => {
    // The util schema layer polyfills globalThis.Float16Array on older runtimes,
    // so this entry should be present in this test process.
    expect(TYPED_ARRAY_CTORS.Float16Array).toBeDefined();
    const arr = new TYPED_ARRAY_CTORS.Float16Array([1, 2, 3]) as ArrayBufferView & {
      length: number;
    };
    expect(arr.length).toBe(3);
  });

  it("includes the documented float/int constructors", () => {
    for (const name of [
      "Float32Array",
      "Float64Array",
      "Int8Array",
      "Uint8Array",
      "Int16Array",
      "Uint16Array",
    ]) {
      expect(TYPED_ARRAY_CTORS[name]).toBeDefined();
    }
  });
});
