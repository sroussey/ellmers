/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, test } from "vitest";

import { TestSmartCloneTask } from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";

describe("Task.smartClone circular reference detection", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let task: TestSmartCloneTask;

  beforeEach(() => {
    task = new TestSmartCloneTask({ id: "test-task", defaults: { data: {} } });
  });

  test("should handle simple objects without circular references", () => {
    const obj = { a: 1, b: { c: 2 } };
    const cloned = task.testSmartClone(obj);

    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
    expect(cloned.b).not.toBe(obj.b);
  });

  test("should handle arrays without circular references", () => {
    const arr = [1, 2, [3, 4]];
    const cloned = task.testSmartClone(arr);

    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[2]).not.toBe(arr[2]);
  });

  test("should throw error on object with circular self-reference", () => {
    const obj: any = { a: 1 };
    obj.self = obj;

    expect(() => task.testSmartClone(obj)).toThrow("Circular reference detected in input data");
  });

  test("should throw error on nested circular reference", () => {
    const obj: any = { a: 1, b: { c: 2 } };
    obj.b.parent = obj;

    expect(() => task.testSmartClone(obj)).toThrow("Circular reference detected in input data");
  });

  test("should throw error on array with circular reference", () => {
    const arr: any = [1, 2, 3];
    arr.push(arr);

    expect(() => task.testSmartClone(arr)).toThrow("Circular reference detected in input data");
  });

  test("should throw error on complex circular reference chain", () => {
    const obj1: any = { name: "obj1" };
    const obj2: any = { name: "obj2", ref: obj1 };
    const obj3: any = { name: "obj3", ref: obj2 };
    obj1.ref = obj3; // Create circular chain

    expect(() => task.testSmartClone(obj1)).toThrow("Circular reference detected in input data");
  });

  test("should handle same object referenced multiple times (not circular)", () => {
    const shared = { value: 42 };
    const obj = { a: shared, b: shared };

    // This should work - same object referenced multiple times is not circular
    // Each reference gets cloned independently
    const cloned = task.testSmartClone(obj);

    expect(cloned).toEqual(obj);
    expect(cloned.a).toEqual(shared);
    expect(cloned.b).toEqual(shared);
    // The cloned references should be different objects (deep clone)
    expect(cloned.a).not.toBe(shared);
    expect(cloned.b).not.toBe(shared);
    expect(cloned.a).not.toBe(cloned.b);
  });

  test("should preserve class instances by reference (no circular check needed)", () => {
    class CustomClass {
      constructor(public value: number) {}
    }

    const instance = new CustomClass(42);
    const obj = { data: instance };

    const cloned = task.testSmartClone(obj);

    expect(cloned.data).toBe(instance); // Should be same reference
    expect(cloned.data.value).toBe(42);
  });

  test("should clone TypedArrays to avoid shared mutation", () => {
    const typedArray = new Float32Array([1.0, 2.0, 3.0]);
    const obj = { data: typedArray };

    const cloned = task.testSmartClone(obj);

    expect(cloned.data).not.toBe(typedArray); // Should be a new instance
    expect(cloned.data).toEqual(typedArray); // But with the same values
    expect(cloned.data).toBeInstanceOf(Float32Array);
  });

  test("should handle null and undefined", () => {
    expect(task.testSmartClone(null)).toBe(null);
    expect(task.testSmartClone(undefined)).toBe(undefined);
    expect(task.testSmartClone({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
  });

  test("should handle primitives", () => {
    expect(task.testSmartClone(42)).toBe(42);
    expect(task.testSmartClone("hello")).toBe("hello");
    expect(task.testSmartClone(true)).toBe(true);
    expect(task.testSmartClone(false)).toBe(false);
  });

  test("should clone nested structures without circular references", () => {
    const obj = {
      level1: {
        level2: {
          level3: {
            value: "deep",
          },
        },
        array: [1, 2, { nested: true }],
      },
    };

    const cloned = task.testSmartClone(obj);

    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
    expect(cloned.level1).not.toBe(obj.level1);
    expect(cloned.level1.level2).not.toBe(obj.level1.level2);
    expect(cloned.level1.array).not.toBe(obj.level1.array);
    expect(cloned.level1.array[2]).not.toBe(obj.level1.array[2]);
  });

  test("should handle mixed object and array structures", () => {
    const obj = {
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      settings: {
        theme: "dark",
        features: ["feature1", "feature2"],
      },
    };

    const cloned = task.testSmartClone(obj);

    expect(cloned).toEqual(obj);
    expect(cloned.users).not.toBe(obj.users);
    expect(cloned.users[0]).not.toBe(obj.users[0]);
    expect(cloned.settings).not.toBe(obj.settings);
    expect(cloned.settings.features).not.toBe(obj.settings.features);
  });
});
