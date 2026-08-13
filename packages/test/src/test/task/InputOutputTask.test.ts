/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskStatus } from "@workglow/task-graph";
import { InputTask, OutputTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

describe("InputTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  it("should have correct static properties", () => {
    expect(InputTask.type).toBe("InputTask");
    expect(InputTask.category).toBe("Flow Control");
    expect(InputTask.hasDynamicSchemas).toBe(true);
    expect(InputTask.cachePolicy.kind).toBe("none");
    // Must be marked passthrough so it is excluded from graph-level progress averaging.
    expect(InputTask.isPassthrough).toBe(true);
  });

  it("should pass through all input as output", async () => {
    const task = new InputTask({ id: "input-test" });
    const result = await task.run({ name: "Alice", count: 5 });
    expect(result).toEqual({ name: "Alice", count: 5 });
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  it("should handle empty input", async () => {
    const task = new InputTask({ id: "input-empty" });
    const result = await task.run({});
    expect(result).toEqual({});
  });

  it("should return default schema when no config schema provided", () => {
    const task = new InputTask({ id: "input-schema" });
    const schema = task.inputSchema();
    expect(schema).toBeTruthy();
    expect(typeof schema).toBe("object");
  });
});

describe("OutputTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  it("should have correct static properties", () => {
    expect(OutputTask.type).toBe("OutputTask");
    expect(OutputTask.category).toBe("Flow Control");
    expect(OutputTask.hasDynamicSchemas).toBe(true);
    expect(OutputTask.cachePolicy.kind).toBe("none");
    // Must be marked passthrough so it is excluded from graph-level progress averaging.
    expect(OutputTask.isPassthrough).toBe(true);
  });

  it("should pass through all input as output", async () => {
    const task = new OutputTask({ id: "output-test" });
    const result = await task.run({ result: "done", value: 42 });
    expect(result).toEqual({ result: "done", value: 42 });
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  it("should handle empty input", async () => {
    const task = new OutputTask({ id: "output-empty" });
    const result = await task.run({});
    expect(result).toEqual({});
  });

  it("should return default schema when no config schema provided", () => {
    const task = new OutputTask({ id: "output-schema" });
    const schema = task.outputSchema();
    expect(schema).toBeTruthy();
    expect(typeof schema).toBe("object");
  });
});
