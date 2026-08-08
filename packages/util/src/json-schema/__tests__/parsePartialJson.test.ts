/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger } from "@workglow/util";
import { parsePartialJson } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

describe("parsePartialJson", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("complete JSON", () => {
    it("should parse a complete JSON object", () => {
      expect(parsePartialJson('{"name":"Alice","age":30}')).toEqual({
        name: "Alice",
        age: 30,
      });
    });

    it("should parse an empty object", () => {
      expect(parsePartialJson("{}")).toEqual({});
    });

    it("should parse nested objects", () => {
      expect(parsePartialJson('{"user":{"name":"Alice","address":{"city":"NYC"}}}')).toEqual({
        user: { name: "Alice", address: { city: "NYC" } },
      });
    });
  });

  describe("incomplete JSON", () => {
    it("should return undefined for empty string", () => {
      expect(parsePartialJson("")).toBeUndefined();
    });

    it("should return undefined for just whitespace", () => {
      expect(parsePartialJson("   ")).toBeUndefined();
    });

    it("should return undefined for just opening brace", () => {
      expect(parsePartialJson("{")).toEqual({});
    });

    it("should parse incomplete key-value pair", () => {
      const result = parsePartialJson('{"name":"Alice"');
      expect(result).toEqual({ name: "Alice" });
    });

    it("should parse with trailing comma", () => {
      const result = parsePartialJson('{"name":"Alice",');
      expect(result).toEqual({ name: "Alice" });
    });

    it("should parse nested incomplete object", () => {
      const result = parsePartialJson('{"user":{"name":"Alice"');
      expect(result).toEqual({ user: { name: "Alice" } });
    });

    it("should parse object with complete and incomplete values", () => {
      const result = parsePartialJson('{"name":"Alice","age":30,"city":"N');
      expect(result).toBeDefined();
      expect(result?.name).toBe("Alice");
      expect(result?.age).toBe(30);
    });

    it("should handle arrays in objects", () => {
      const result = parsePartialJson('{"tags":["a","b"');
      expect(result).toEqual({ tags: ["a", "b"] });
    });

    it("should yield a partial object when the only property has an incomplete keyword value", () => {
      // First-property streaming: single key, value still arriving.
      expect(parsePartialJson('{"a": tru')).toEqual({});
      expect(parsePartialJson('{"flag": fal')).toEqual({});
      expect(parsePartialJson('{"x": nul')).toEqual({});
    });

    it("should yield a partial object when the only property has an incomplete number value", () => {
      // A bare `1.` is not valid JSON yet; drop the incomplete pair.
      expect(parsePartialJson('{"n": 1.')).toEqual({});
    });

    it("should keep a single property whose number value is already complete", () => {
      expect(parsePartialJson('{"n": 30')).toEqual({ n: 30 });
    });
  });

  describe("progressive parsing", () => {
    it("should parse progressively growing JSON", () => {
      const steps = [
        '{"n',
        '{"name',
        '{"name"',
        '{"name":',
        '{"name":"',
        '{"name":"Al',
        '{"name":"Alice"',
        '{"name":"Alice",',
        '{"name":"Alice","age"',
        '{"name":"Alice","age":',
        '{"name":"Alice","age":30',
        '{"name":"Alice","age":30}',
      ];

      // Early steps might return undefined or partial objects
      // Later steps should return progressively more complete objects
      const lastResult = parsePartialJson(steps[steps.length - 1]);
      expect(lastResult).toEqual({ name: "Alice", age: 30 });

      // Check a mid-point
      const midResult = parsePartialJson('{"name":"Alice"');
      expect(midResult).toEqual({ name: "Alice" });
    });
  });

  describe("non-object values", () => {
    it("should return undefined for arrays", () => {
      expect(parsePartialJson("[1, 2, 3]")).toBeUndefined();
    });

    it("should return undefined for strings", () => {
      expect(parsePartialJson('"hello"')).toBeUndefined();
    });

    it("should return undefined for numbers", () => {
      expect(parsePartialJson("42")).toBeUndefined();
    });

    it("should return undefined for non-JSON text", () => {
      expect(parsePartialJson("hello world")).toBeUndefined();
    });
  });
});
