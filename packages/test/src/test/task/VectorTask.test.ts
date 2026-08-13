/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  VectorDotProductTask,
  VectorMultiplyTask,
  VectorNormalizeTask,
  VectorSubtractTask,
  VectorSumTask,
} from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("VectorTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("VectorSumTask", () => {
    test("sums array of TypedArrays component-wise", async () => {
      const task = new VectorSumTask();
      const vectors = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
      const result = await task.run({ vectors });
      expect(Array.from(result.result)).toEqual([5, 7, 9]);
    });
  });

  describe("VectorDotProductTask", () => {
    test("computes dot product", async () => {
      const task = new VectorDotProductTask();
      const vectors = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
      const result = await task.run({ vectors });
      expect(result.result).toBe(32); // 1*4 + 2*5 + 3*6 = 4+10+18
    });
  });

  describe("VectorNormalizeTask", () => {
    test("normalizes vector to unit length", async () => {
      const task = new VectorNormalizeTask();
      const vector = new Float32Array([3, 4]);
      const result = await task.run({ vector });
      const mag = Math.sqrt(result.result[0] ** 2 + result.result[1] ** 2);
      expect(mag).toBeCloseTo(1);
    });
  });

  describe("VectorSubtractTask", () => {
    test("subtracts vectors array: v0 - v1 - v2", async () => {
      const task = new VectorSubtractTask();
      const vectors = [
        new Float32Array([10, 20, 30]),
        new Float32Array([1, 2, 3]),
        new Float32Array([2, 3, 4]),
      ];
      const result = await task.run({ vectors });
      expect(Array.from(result.result)).toEqual([7, 15, 23]); // 10-1-2=7, 20-2-3=15, 30-3-4=23
    });
  });

  describe("VectorMultiplyTask widest type", () => {
    test("Int8Array * Float32Array yields Float32Array", async () => {
      const task = new VectorMultiplyTask();
      const vectors = [new Int8Array([1, 2, 3]), new Float32Array([2, 3, 4])];
      const result = await task.run({ vectors });
      expect(result.result).toBeInstanceOf(Float32Array);
      expect(Array.from(result.result)).toEqual([2, 6, 12]);
    });
  });
});
