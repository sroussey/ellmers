/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskStatus } from "@workglow/task-graph";
import { RegexTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

describe("RegexTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);
  let task: RegexTask;

  beforeEach(() => {
    task = new RegexTask({ id: "regex-test" });
  });

  it("should have correct static properties", () => {
    expect(RegexTask.type).toBe("RegexTask");
    expect(RegexTask.category).toBe("String");
  });

  it("should match a simple pattern", async () => {
    const result = await task.run({
      value: "hello world",
      pattern: "hello",
    });
    expect(result.match).toBe(true);
    expect(result.matches).toContain("hello");
  });

  it("should return no match for non-matching pattern", async () => {
    const result = await task.run({
      value: "hello world",
      pattern: "xyz",
    });
    expect(result.match).toBe(false);
    expect(result.matches).toEqual([]);
  });

  it("should support case-insensitive flag", async () => {
    const result = await task.run({
      value: "Hello World",
      pattern: "hello",
      flags: "i",
    });
    expect(result.match).toBe(true);
    expect(result.matches[0]).toBe("Hello");
  });

  it("should return all matches with global flag", async () => {
    const result = await task.run({
      value: "cat bat hat",
      pattern: "[a-z]at",
      flags: "g",
    });
    expect(result.match).toBe(true);
    expect(result.matches).toEqual(["cat", "bat", "hat"]);
  });

  it("should return capture groups without global flag", async () => {
    const result = await task.run({
      value: "2025-03-26",
      pattern: "(\\d{4})-(\\d{2})-(\\d{2})",
    });
    expect(result.match).toBe(true);
    expect(result.matches[0]).toBe("2025-03-26");
    expect(result.matches[1]).toBe("2025");
    expect(result.matches[2]).toBe("03");
    expect(result.matches[3]).toBe("26");
  });

  it("should handle global + case-insensitive flags together", async () => {
    const result = await task.run({
      value: "Cat cat CAT",
      pattern: "cat",
      flags: "gi",
    });
    expect(result.match).toBe(true);
    expect(result.matches).toHaveLength(3);
  });

  it("should handle empty flags", async () => {
    const result = await task.run({
      value: "test",
      pattern: "test",
      flags: "",
    });
    expect(result.match).toBe(true);
  });

  it("should complete with COMPLETED status", async () => {
    await task.run({ value: "abc", pattern: "abc" });
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });
});
