/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ScalarAddTask, ScalarSumTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("ScalarMath", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("ScalarAddTask", () => {
    test("adds two numbers using sumPrecise", async () => {
      const task = new ScalarAddTask();
      const result = await task.run({ a: 1.1, b: 2.2 });
      expect(result.result).toBeCloseTo(3.3);
    });
  });

  describe("ScalarSumTask", () => {
    test("sums array of numbers", async () => {
      const task = new ScalarSumTask();
      const result = await task.run({ values: [1, 2, 3, 4, 5] });
      expect(result.result).toBe(15);
    });
  });
});
