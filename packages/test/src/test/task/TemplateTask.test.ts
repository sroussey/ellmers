/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskStatus } from "@workglow/task-graph";
import { TemplateTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

describe("TemplateTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);
  let task: TemplateTask;

  beforeEach(() => {
    task = new TemplateTask({ id: "template-test" });
  });

  it("should have correct static properties", () => {
    expect(TemplateTask.type).toBe("TemplateTask");
    expect(TemplateTask.category).toBe("Utility");
  });

  it("should replace simple placeholders", async () => {
    const result = await task.run({
      template: "Hello, {{name}}!",
      values: { name: "World" },
    });
    expect(result.result).toBe("Hello, World!");
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  it("should replace multiple placeholders", async () => {
    const result = await task.run({
      template: "{{greeting}}, {{name}}!",
      values: { greeting: "Hi", name: "Alice" },
    });
    expect(result.result).toBe("Hi, Alice!");
  });

  it("should use default value when key is missing", async () => {
    const result = await task.run({
      template: "Hello, {{name|stranger}}!",
      values: {},
    });
    expect(result.result).toBe("Hello, stranger!");
  });

  it("should use actual value over default when key exists", async () => {
    const result = await task.run({
      template: "Hello, {{name|stranger}}!",
      values: { name: "Bob" },
    });
    expect(result.result).toBe("Hello, Bob!");
  });

  it("should resolve nested dot-notation paths", async () => {
    const result = await task.run({
      template: "City: {{address.city}}",
      values: { address: { city: "Paris" } },
    });
    expect(result.result).toBe("City: Paris");
  });

  it("should return empty string for missing keys without default", async () => {
    const result = await task.run({
      template: "Hello, {{name}}!",
      values: {},
    });
    expect(result.result).toBe("Hello, !");
  });

  it("should handle deeply nested paths", async () => {
    const result = await task.run({
      template: "{{a.b.c.d}}",
      values: { a: { b: { c: { d: "deep" } } } },
    });
    expect(result.result).toBe("deep");
  });

  it("should return empty string for broken nested path", async () => {
    const result = await task.run({
      template: "{{a.b.c}}",
      values: { a: { x: 1 } },
    });
    expect(result.result).toBe("");
  });

  it("should convert non-string values to string", async () => {
    const result = await task.run({
      template: "Count: {{count}}",
      values: { count: 42 },
    });
    expect(result.result).toBe("Count: 42");
  });

  it("should handle template with no placeholders", async () => {
    const result = await task.run({
      template: "No placeholders here",
      values: { name: "ignored" },
    });
    expect(result.result).toBe("No placeholders here");
  });

  it("should leave nested braces intact without backtracking", async () => {
    // Adversarial input: many "{{|" with no closing "}}" used to cause
    // polynomial backtracking in /\{\{([^}]+)\}\}/g — the [^{}] fix bounds
    // matching cost to O(n).
    const adversarial = "{{|".repeat(50_000);
    const start = Date.now();
    const result = await task.run({ template: adversarial, values: {} });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.result).toBe(adversarial);
  });

  it("should not match a placeholder that contains an inner {{", async () => {
    const result = await task.run({
      template: "{{outer{{inner}}}}",
      values: { inner: "X" },
    });
    // Inner placeholder still resolves; the outer "{{outer..." has an
    // unbalanced "{{" so it is left as literal text.
    expect(result.result).toBe("{{outerX}}");
  });
});
