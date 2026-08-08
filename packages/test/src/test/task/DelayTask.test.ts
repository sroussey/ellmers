/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskAbortedError, TaskStatus } from "@workglow/task-graph";
import { DelayTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

describe("DelayTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let task: DelayTask;

  beforeEach(() => {
    task = new DelayTask({ id: "delayed", delay: 10 });
  });

  it("should complete successfully with short delay", async () => {
    const result = await task.run();

    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect(result).toEqual({});
  });

  it("should pass through input to output", async () => {
    const taskWithInput = new DelayTask({
      id: "delayed-with-input",
      delay: 10,
      defaults: { something: "test-value" },
    });

    const result = await taskWithInput.run();

    expect(result).toEqual({ something: "test-value" });
    expect(taskWithInput.status).toBe(TaskStatus.COMPLETED);
    expect(taskWithInput.runOutputData).toEqual({ something: "test-value" });
  });

  it("should handle task abortion", async () => {
    try {
      const resultPromise = task.run();
      task.abort();
      await resultPromise;
    } catch (error) {
      expect(error).toBeInstanceOf(TaskAbortedError);
    }
  });
});
