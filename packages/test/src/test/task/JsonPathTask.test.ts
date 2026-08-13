/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskStatus } from "@workglow/task-graph";
import { JsonPathTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

describe("JsonPathTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);
  let task: JsonPathTask;

  beforeEach(() => {
    task = new JsonPathTask({ id: "jsonpath-test" });
  });

  it("should have correct static properties", () => {
    expect(JsonPathTask.type).toBe("JsonPathTask");
    expect(JsonPathTask.category).toBe("Utility");
  });

  it("should extract a top-level property", async () => {
    const result = await task.run({
      value: { name: "Alice", age: 30 },
      path: "name",
    });
    expect(result.result).toBe("Alice");
  });

  it("should extract a nested property", async () => {
    const result = await task.run({
      value: { user: { address: { city: "Paris" } } },
      path: "user.address.city",
    });
    expect(result.result).toBe("Paris");
  });

  it("should extract an array element by index", async () => {
    const result = await task.run({
      value: { items: ["a", "b", "c"] },
      path: "items.1",
    });
    expect(result.result).toBe("b");
  });

  it("should return undefined for missing path", async () => {
    const result = await task.run({
      value: { name: "Alice" },
      path: "address.city",
    });
    expect(result.result).toBeUndefined();
  });

  it("should support wildcard on arrays", async () => {
    const result = await task.run({
      value: { items: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      path: "items.*.name",
    });
    expect(result.result).toEqual(["A", "B", "C"]);
  });

  it("should support wildcard on objects", async () => {
    const result = await task.run({
      value: { users: { u1: { age: 20 }, u2: { age: 30 } } },
      path: "users.*.age",
    });
    expect(result.result).toEqual([20, 30]);
  });

  it("should return undefined for wildcard on non-iterable", async () => {
    const result = await task.run({
      value: { name: "Alice" },
      path: "name.*",
    });
    expect(result.result).toBeUndefined();
  });

  it("should return undefined for empty path (accessing non-existent key)", async () => {
    const result = await task.run({
      value: { a: 1 },
      path: "",
    });
    // empty string split gives [""], which tries to access key ""
    // This is expected behavior - accessing a key that doesn't exist
    expect(result.result).toBeUndefined();
  });

  it("should complete with COMPLETED status", async () => {
    await task.run({ value: { x: 1 }, path: "x" });
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });
});
