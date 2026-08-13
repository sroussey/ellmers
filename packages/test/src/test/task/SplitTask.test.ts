/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskGraph, TaskStatus, Workflow } from "@workglow/task-graph";
import { split, SplitTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("SplitTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  test("splits an array into individual outputs", async () => {
    const result = await split({
      input: [1, 2, 3, 4, 5],
    });
    expect(result.output_0).toBe(1);
    expect(result.output_1).toBe(2);
    expect(result.output_2).toBe(3);
    expect(result.output_3).toBe(4);
    expect(result.output_4).toBe(5);
  });

  test("splits a string array into individual outputs", async () => {
    const result = await split({
      input: ["apple", "banana", "cherry"],
    });
    expect(result.output_0).toBe("apple");
    expect(result.output_1).toBe("banana");
    expect(result.output_2).toBe("cherry");
  });

  test("handles a single value as a single-element array", async () => {
    const result = await split({
      input: "single value",
    });
    expect(result.output_0).toBe("single value");
    expect(Object.keys(result).length).toBe(1);
  });

  test("handles a single number", async () => {
    const result = await split({
      input: 42,
    });
    expect(result.output_0).toBe(42);
    expect(Object.keys(result).length).toBe(1);
  });

  test("handles an empty array", async () => {
    const result = await split({
      input: [],
    });
    expect(Object.keys(result).length).toBe(0);
  });

  test("handles array with objects", async () => {
    const result = await split({
      input: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(result.output_0).toEqual({ id: 1 });
    expect(result.output_1).toEqual({ id: 2 });
    expect(result.output_2).toEqual({ id: 3 });
  });

  test("handles array with mixed types", async () => {
    const result = await split({
      input: [1, "two", { three: 3 }, true, null],
    });
    expect(result.output_0).toBe(1);
    expect(result.output_1).toBe("two");
    expect(result.output_2).toEqual({ three: 3 });
    expect(result.output_3).toBe(true);
    expect(result.output_4).toBe(null);
  });

  test("in task mode", async () => {
    const task = new SplitTask({ id: "split-task", defaults: { input: ["a", "b", "c"] } });
    const result = await task.run();
    expect(result.output_0).toBe("a");
    expect(result.output_1).toBe("b");
    expect(result.output_2).toBe("c");
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  test("in task graph mode", async () => {
    const graph = new TaskGraph();
    graph.addTask(new SplitTask({ id: "split-in-graph", defaults: { input: [10, 20, 30] } }));
    const results = await graph.run();
    expect(results[0].data.output_0).toBe(10);
    expect(results[0].data.output_1).toBe(20);
    expect(results[0].data.output_2).toBe(30);
  });

  test("in workflow mode", async () => {
    const workflow = new Workflow();
    workflow.split({
      input: [100, 200, 300],
    });
    const results = await workflow.run();
    expect(results.output_0).toBe(100);
    expect(results.output_1).toBe(200);
    expect(results.output_2).toBe(300);
  });

  test("static properties are correct", () => {
    expect(SplitTask.type).toBe("SplitTask");
    expect(SplitTask.category).toBe("Utility");
    expect(SplitTask.title).toBe("Split");
    expect(SplitTask.description).toContain("Splits an array");
  });

  test("input and output schemas are defined", () => {
    const inputSchema = SplitTask.inputSchema();
    const outputSchema = SplitTask.outputSchema();
    expect(inputSchema).toBeDefined();
    expect(outputSchema).toBeDefined();
    expect(inputSchema.additionalProperties).toBe(false);
    expect(outputSchema.additionalProperties).toBe(true);
  });

  test("handles single-element array", async () => {
    const result = await split({
      input: [999],
    });
    expect(result.output_0).toBe(999);
    expect(Object.keys(result).length).toBe(1);
  });

  test("task metadata is preserved", async () => {
    const task = new SplitTask({
      id: "test-metadata",
      title: "Test Split Task",
      defaults: { input: [1, 2] },
    });
    await task.run();
    expect(task.id).toBe("test-metadata");
    expect(task.config.title).toBe("Test Split Task");
  });

  test("handles array with nested arrays", async () => {
    const result = await split({
      input: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    });
    expect(result.output_0).toEqual([1, 2]);
    expect(result.output_1).toEqual([3, 4]);
    expect(result.output_2).toEqual([5, 6]);
  });

  test("preserves undefined values in array", async () => {
    const result = await split({
      input: [1, undefined, 3],
    });
    expect(result.output_0).toBe(1);
    expect(result.output_1).toBeUndefined();
    expect(result.output_2).toBe(3);
  });

  test("handles boolean single value", async () => {
    const result = await split({
      input: true,
    });
    expect(result.output_0).toBe(true);
  });
});
