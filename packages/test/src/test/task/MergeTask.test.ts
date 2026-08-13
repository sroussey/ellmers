/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskGraph, TaskStatus, Workflow } from "@workglow/task-graph";
import { merge, MergeTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("MergeTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  test("merges multiple inputs into a single array", async () => {
    const result = await merge({
      input_0: 1,
      input_1: 2,
      input_2: 3,
      input_3: 4,
      input_4: 5,
    });
    expect(result.output).toEqual([1, 2, 3, 4, 5]);
  });

  test("merges string inputs into an array", async () => {
    const result = await merge({
      input_0: "apple",
      input_1: "banana",
      input_2: "cherry",
    });
    expect(result.output).toEqual(["apple", "banana", "cherry"]);
  });

  test("handles a single input", async () => {
    const result = await merge({
      input_0: "single value",
    });
    expect(result.output).toEqual(["single value"]);
  });

  test("handles empty input object", async () => {
    const result = await merge({});
    expect(result.output).toEqual([]);
  });

  test("handles object inputs", async () => {
    const result = await merge({
      input_0: { id: 1 },
      input_1: { id: 2 },
      input_2: { id: 3 },
    });
    expect(result.output).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  test("handles mixed type inputs", async () => {
    const result = await merge({
      input_0: 1,
      input_1: "two",
      input_2: { three: 3 },
      input_3: true,
      input_4: null,
    });
    expect(result.output).toEqual([1, "two", { three: 3 }, true, null]);
  });

  test("sorts inputs by key name", async () => {
    const result = await merge({
      z: "last",
      a: "first",
      m: "middle",
    });
    expect(result.output).toEqual(["first", "middle", "last"]);
  });

  test("handles numeric-like keys in order", async () => {
    const result = await merge({
      input_10: "ten",
      input_1: "one",
      input_2: "two",
    });
    // Sorted with natural numeric ordering: input_1, input_2, input_10
    expect(result.output).toEqual(["one", "two", "ten"]);
  });

  test("handles keys with underscores and dashes", async () => {
    const result = await merge({
      key_3: "c",
      key_1: "a",
      key_2: "b",
    });
    expect(result.output).toEqual(["a", "b", "c"]);
  });

  test("in task mode", async () => {
    const task = new MergeTask({
      id: "merge-task",
      defaults: { a: "first", b: "second", c: "third" },
    });
    const result = await task.run();
    expect(result.output).toEqual(["first", "second", "third"]);
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  test("in task graph mode", async () => {
    const graph = new TaskGraph();
    graph.addTask(
      new MergeTask({
        id: "merge-in-graph",
        defaults: { x: 10, y: 20, z: 30 },
      })
    );
    const results = await graph.run();
    expect(results[0].data.output).toEqual([10, 20, 30]);
  });

  test("in workflow mode", async () => {
    const workflow = new Workflow();
    workflow.merge({
      first: 100,
      second: 200,
      third: 300,
    });
    const results = await workflow.run();
    expect(results.output).toEqual([100, 200, 300]);
  });

  test("static properties are correct", () => {
    expect(MergeTask.type).toBe("MergeTask");
    expect(MergeTask.category).toBe("Utility");
    expect(MergeTask.title).toBe("Merge");
    expect(MergeTask.description).toContain("Merges multiple inputs into a single array");
  });

  test("input and output schemas are defined", () => {
    const inputSchema = MergeTask.inputSchema();
    const outputSchema = MergeTask.outputSchema();
    expect(inputSchema).toBeDefined();
    expect(outputSchema).toBeDefined();
    expect(inputSchema.additionalProperties).toBe(true);
    expect(outputSchema.additionalProperties).toBe(false);
  });

  test("task metadata is preserved", async () => {
    const task = new MergeTask({
      id: "test-metadata",
      title: "Test Merge Task",
      defaults: { a: 1, b: 2 },
    });
    await task.run();
    expect(task.id).toBe("test-metadata");
    expect(task.config.title).toBe("Test Merge Task");
  });

  test("handles array inputs (merges arrays as elements)", async () => {
    const result = await merge({
      input_0: [1, 2],
      input_1: [3, 4],
      input_2: [5, 6],
    });
    expect(result.output).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  test("handles undefined values", async () => {
    const result = await merge({
      input_0: 1,
      input_1: undefined,
      input_2: 3,
    });
    expect(result.output).toEqual([1, undefined, 3]);
  });

  test("handles boolean inputs", async () => {
    const result = await merge({
      input_0: true,
      input_1: false,
      input_2: true,
    });
    expect(result.output).toEqual([true, false, true]);
  });

  test("preserves input order when keys are sorted", async () => {
    const result = await merge({
      c: "third",
      a: "first",
      b: "second",
      d: "fourth",
    });
    expect(result.output).toEqual(["first", "second", "third", "fourth"]);
  });

  test("handles keys with special characters", async () => {
    const result = await merge({
      "key.1": "one",
      "key.2": "two",
      "key.3": "three",
    });
    expect(result.output).toEqual(["one", "two", "three"]);
  });
});
