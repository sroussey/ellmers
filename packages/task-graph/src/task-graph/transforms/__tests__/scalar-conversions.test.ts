/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  numberToStringTransform,
  parseJsonTransform,
  stringifyTransform,
  toBooleanTransform,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

describe("numberToString", () => {
  it("converts number to string", async () => {
    expect(await numberToStringTransform.apply(42, {})).toBe("42");
  });
  it("inferOutputSchema returns string", () => {
    expect(
      numberToStringTransform.inferOutputSchema({ type: "number" } as DataPortSchema, {})
    ).toEqual({
      type: "string",
    });
  });
  it("suggestFromSchemas number -> string", () => {
    const res = numberToStringTransform.suggestFromSchemas!(
      { type: "number" } as DataPortSchema,
      { type: "string" } as DataPortSchema
    );
    expect(res?.score).toBeGreaterThan(0.5);
  });
});

describe("toBoolean", () => {
  it("maps 'true' -> true", async () =>
    expect(await toBooleanTransform.apply("true", {})).toBe(true));
  it("maps 'false' -> false", async () =>
    expect(await toBooleanTransform.apply("false", {})).toBe(false));
  it("maps 1 -> true", async () => expect(await toBooleanTransform.apply(1, {})).toBe(true));
  it("maps 0 -> false", async () => expect(await toBooleanTransform.apply(0, {})).toBe(false));
});

describe("stringify", () => {
  it("stringifies an object", async () => {
    expect(await stringifyTransform.apply({ a: 1 }, {})).toBe('{"a":1}');
  });
});

describe("parseJson", () => {
  it("parses a JSON string", async () => {
    expect(await parseJsonTransform.apply('{"a":1}', {})).toEqual({ a: 1 });
  });
});
