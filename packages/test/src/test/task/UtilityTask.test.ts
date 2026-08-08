/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DateFormatTask, JsonPathTask, RegexTask, TemplateTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("UtilityTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("JsonPathTask", () => {
    test("extracts nested value", async () => {
      const task = new JsonPathTask();
      const result = await task.run({
        value: { a: { b: { c: 42 } } },
        path: "a.b.c",
      });
      expect(result.result).toBe(42);
    });

    test("extracts array element by index", async () => {
      const task = new JsonPathTask();
      const result = await task.run({
        value: { items: ["first", "second", "third"] },
        path: "items.1",
      });
      expect(result.result).toBe("second");
    });

    test("extracts with wildcard", async () => {
      const task = new JsonPathTask();
      const result = await task.run({
        value: { items: [{ name: "a" }, { name: "b" }] },
        path: "items.*.name",
      });
      expect(result.result).toEqual(["a", "b"]);
    });

    test("returns undefined for missing path", async () => {
      const task = new JsonPathTask();
      const result = await task.run({
        value: { a: 1 },
        path: "b.c",
      });
      expect(result.result).toBeUndefined();
    });

    test("extracts top-level property", async () => {
      const task = new JsonPathTask();
      const result = await task.run({
        value: { name: "test" },
        path: "name",
      });
      expect(result.result).toBe("test");
    });
  });

  describe("TemplateTask", () => {
    test("renders simple template", async () => {
      const task = new TemplateTask();
      const result = await task.run({
        template: "Hello, {{name}}!",
        values: { name: "World" },
      });
      expect(result.result).toBe("Hello, World!");
    });

    test("supports dot-notation paths", async () => {
      const task = new TemplateTask();
      const result = await task.run({
        template: "User: {{user.name}}",
        values: { user: { name: "Alice" } },
      });
      expect(result.result).toBe("User: Alice");
    });

    test("supports default values", async () => {
      const task = new TemplateTask();
      const result = await task.run({
        template: "Hello, {{name | stranger}}!",
        values: {},
      });
      expect(result.result).toBe("Hello, stranger!");
    });

    test("uses value over default when present", async () => {
      const task = new TemplateTask();
      const result = await task.run({
        template: "Hello, {{name | stranger}}!",
        values: { name: "Alice" },
      });
      expect(result.result).toBe("Hello, Alice!");
    });

    test("replaces missing keys without default with empty string", async () => {
      const task = new TemplateTask();
      const result = await task.run({
        template: "Hello, {{name}}!",
        values: {},
      });
      expect(result.result).toBe("Hello, !");
    });
  });

  describe("DateFormatTask", () => {
    test("formats to ISO string", async () => {
      const task = new DateFormatTask();
      const result = await task.run({
        value: "2025-01-15T12:00:00.000Z",
        format: "iso",
      });
      expect(result.result).toBe("2025-01-15T12:00:00.000Z");
    });

    test("formats unix timestamp", async () => {
      const task = new DateFormatTask();
      const result = await task.run({
        value: "2025-01-15T12:00:00.000Z",
        format: "unix",
      });
      expect(result.result).toBe(String(new Date("2025-01-15T12:00:00.000Z").getTime()));
    });

    test("parses numeric string as unix ms", async () => {
      const task = new DateFormatTask();
      const ts = String(new Date("2025-06-01T00:00:00.000Z").getTime());
      const result = await task.run({ value: ts, format: "iso" });
      expect(result.result).toBe("2025-06-01T00:00:00.000Z");
    });

    test("defaults to iso format", async () => {
      const task = new DateFormatTask();
      const result = await task.run({ value: "2025-01-15T12:00:00.000Z" });
      expect(result.result).toBe("2025-01-15T12:00:00.000Z");
    });

    test("throws on invalid date", async () => {
      const task = new DateFormatTask();
      await expect(task.run({ value: "not-a-date" })).rejects.toThrow("Invalid date");
    });
  });

  describe("RegexTask", () => {
    test("matches simple pattern", async () => {
      const task = new RegexTask();
      const result = await task.run({
        value: "hello world",
        pattern: "hello",
      });
      expect(result.match).toBe(true);
      expect(result.matches).toEqual(["hello"]);
    });

    test("returns false for no match", async () => {
      const task = new RegexTask();
      const result = await task.run({
        value: "hello world",
        pattern: "xyz",
      });
      expect(result.match).toBe(false);
      expect(result.matches).toEqual([]);
    });

    test("captures groups", async () => {
      const task = new RegexTask();
      const result = await task.run({
        value: "2025-01-15",
        pattern: "(\\d{4})-(\\d{2})-(\\d{2})",
      });
      expect(result.match).toBe(true);
      expect(result.matches).toEqual(["2025-01-15", "2025", "01", "15"]);
    });

    test("global flag returns all matches", async () => {
      const task = new RegexTask();
      const result = await task.run({
        value: "cat bat hat",
        pattern: "\\w+at",
        flags: "g",
      });
      expect(result.match).toBe(true);
      expect(result.matches).toEqual(["cat", "bat", "hat"]);
    });

    test("case insensitive flag", async () => {
      const task = new RegexTask();
      const result = await task.run({
        value: "Hello HELLO hello",
        pattern: "hello",
        flags: "gi",
      });
      expect(result.match).toBe(true);
      expect(result.matches).toEqual(["Hello", "HELLO", "hello"]);
    });
  });
});
