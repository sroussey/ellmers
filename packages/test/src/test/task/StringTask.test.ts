/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  StringConcatTask,
  StringIncludesTask,
  StringJoinTask,
  StringLengthTask,
  StringLowerCaseTask,
  StringReplaceTask,
  StringSliceTask,
  StringTemplateTask,
  StringTrimTask,
  StringUpperCaseTask,
} from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("StringTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("StringConcatTask", () => {
    test("concatenates two strings", async () => {
      const task = new StringConcatTask();
      const result = await task.run({ a: "hello", b: " world" });
      expect(result.text).toBe("hello world");
    });

    test("concatenates empty strings", async () => {
      const task = new StringConcatTask();
      const result = await task.run({ a: "", b: "" });
      expect(result.text).toBe("");
    });
  });

  describe("StringJoinTask", () => {
    test("joins strings with separator", async () => {
      const task = new StringJoinTask();
      const result = await task.run({ texts: ["a", "b", "c"], separator: ", " });
      expect(result.text).toBe("a, b, c");
    });

    test("joins with default empty separator", async () => {
      const task = new StringJoinTask();
      const result = await task.run({ texts: ["a", "b", "c"] });
      expect(result.text).toBe("abc");
    });

    test("joins single element", async () => {
      const task = new StringJoinTask();
      const result = await task.run({ texts: ["only"], separator: "-" });
      expect(result.text).toBe("only");
    });
  });

  describe("StringUpperCaseTask", () => {
    test("converts to upper case", async () => {
      const task = new StringUpperCaseTask();
      const result = await task.run({ text: "hello world" });
      expect(result.text).toBe("HELLO WORLD");
    });
  });

  describe("StringLowerCaseTask", () => {
    test("converts to lower case", async () => {
      const task = new StringLowerCaseTask();
      const result = await task.run({ text: "HELLO WORLD" });
      expect(result.text).toBe("hello world");
    });
  });

  describe("StringTrimTask", () => {
    test("trims whitespace", async () => {
      const task = new StringTrimTask();
      const result = await task.run({ text: "  hello  " });
      expect(result.text).toBe("hello");
    });

    test("trims tabs and newlines", async () => {
      const task = new StringTrimTask();
      const result = await task.run({ text: "\n\thello\n\t" });
      expect(result.text).toBe("hello");
    });
  });

  describe("StringReplaceTask", () => {
    test("replaces all occurrences", async () => {
      const task = new StringReplaceTask();
      const result = await task.run({ text: "foo bar foo", search: "foo", replace: "baz" });
      expect(result.text).toBe("baz bar baz");
    });

    test("replaces with empty string", async () => {
      const task = new StringReplaceTask();
      const result = await task.run({ text: "hello world", search: " ", replace: "" });
      expect(result.text).toBe("helloworld");
    });
  });

  describe("StringSliceTask", () => {
    test("slices from start to end", async () => {
      const task = new StringSliceTask();
      const result = await task.run({ text: "hello world", start: 0, end: 5 });
      expect(result.text).toBe("hello");
    });

    test("slices from start without end", async () => {
      const task = new StringSliceTask();
      const result = await task.run({ text: "hello world", start: 6 });
      expect(result.text).toBe("world");
    });

    test("supports negative indexing", async () => {
      const task = new StringSliceTask();
      const result = await task.run({ text: "hello world", start: -5 });
      expect(result.text).toBe("world");
    });
  });

  describe("StringLengthTask", () => {
    test("returns string length", async () => {
      const task = new StringLengthTask();
      const result = await task.run({ text: "hello" });
      expect(result.length).toBe(5);
    });

    test("returns 0 for empty string", async () => {
      const task = new StringLengthTask();
      const result = await task.run({ text: "" });
      expect(result.length).toBe(0);
    });
  });

  describe("StringIncludesTask", () => {
    test("returns true when substring is found", async () => {
      const task = new StringIncludesTask();
      const result = await task.run({ text: "hello world", search: "world" });
      expect(result.included).toBe(true);
    });

    test("returns false when substring is not found", async () => {
      const task = new StringIncludesTask();
      const result = await task.run({ text: "hello world", search: "xyz" });
      expect(result.included).toBe(false);
    });
  });

  describe("StringTemplateTask", () => {
    test("replaces placeholders", async () => {
      const task = new StringTemplateTask();
      const result = await task.run({
        template: "Hello, {{name}}!",
        values: { name: "World" },
      });
      expect(result.text).toBe("Hello, World!");
    });

    test("replaces multiple placeholders", async () => {
      const task = new StringTemplateTask();
      const result = await task.run({
        template: "{{greeting}}, {{name}}!",
        values: { greeting: "Hi", name: "Alice" },
      });
      expect(result.text).toBe("Hi, Alice!");
    });

    test("handles missing values", async () => {
      const task = new StringTemplateTask();
      const result = await task.run({
        template: "Hello, {{name}}!",
        values: {},
      });
      expect(result.text).toBe("Hello, {{name}}!");
    });
  });
});
