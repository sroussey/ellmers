/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collectPropertyValues,
  deepEqual,
  forceArray,
  serialize,
  sleep,
  sortObject,
  toSQLiteTimestamp,
} from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("forceArray", () => {
  it("should wrap a single value in an array", () => {
    expect(forceArray("hello")).toEqual(["hello"]);
  });

  it("should return an array unchanged", () => {
    expect(forceArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("should wrap null in an array", () => {
    expect(forceArray(null)).toEqual([null]);
  });
});

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("should resolve after the specified time", async () => {
    let resolved = false;
    const sleepPromise = sleep(50).then(() => {
      resolved = true;
    });
    vi.advanceTimersByTime(50);
    await sleepPromise;
    expect(resolved).toBe(true);
  });
});

describe("collectPropertyValues", () => {
  it("should collect values from array of objects", () => {
    const result = collectPropertyValues([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);
    expect(result.name).toEqual(["Alice", "Bob"]);
    expect(result.age).toEqual([30, 25]);
  });

  it("should handle empty array", () => {
    const result = collectPropertyValues([]);
    expect(result).toEqual({});
  });

  it("should handle single item", () => {
    const result = collectPropertyValues([{ x: 1 }]);
    expect(result.x).toEqual([1]);
  });
});

describe("toSQLiteTimestamp", () => {
  it("should format a date as SQLite timestamp", () => {
    const date = new Date("2025-03-15T10:30:45Z");
    const result = toSQLiteTimestamp(date);
    expect(result).toBe("2025-03-15 10:30:45");
  });

  it("should return null for null input", () => {
    expect(toSQLiteTimestamp(null)).toBeNull();
  });

  it("should return null for undefined input", () => {
    expect(toSQLiteTimestamp(undefined)).toBeNull();
  });

  it("should pad single-digit month and day", () => {
    const date = new Date("2025-01-05T03:07:09Z");
    const result = toSQLiteTimestamp(date);
    expect(result).toBe("2025-01-05 03:07:09");
  });
});

describe("deepEqual", () => {
  it("should return true for identical primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
  });

  it("should return false for different primitives", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
  });

  it("should compare objects deeply", () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("should return false for objects with different keys", () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("should handle null and undefined", () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it("should compare array buffer views by their bytes", () => {
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);

    const first = new DataView(new Uint8Array([1, 2]).buffer);
    const second = new DataView(new Uint8Array([1, 3]).buffer);

    expect(deepEqual(first, second)).toBe(false);
  });
});

describe("sortObject", () => {
  it("should sort object keys alphabetically", () => {
    const result = sortObject({ c: 3, a: 1, b: 2 });
    expect(Object.keys(result)).toEqual(["a", "b", "c"]);
  });

  it("should preserve values", () => {
    const result = sortObject({ b: "two", a: "one" });
    expect(result.a).toBe("one");
    expect(result.b).toBe("two");
  });
});

describe("serialize", () => {
  it("should serialize with sorted keys", () => {
    const result = serialize({ b: 2, a: 1 });
    expect(result).toBe('{"a":1,"b":2}');
  });

  it("should produce consistent output regardless of key order", () => {
    expect(serialize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(serialize({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });
});
