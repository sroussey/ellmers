/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { pipe, Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

import {
  AddFiveTask,
  PipelineDoubleTask as DoubleTask,
  InMemoryTaskOutputRepository,
  PipelineSquareTask as SquareTask,
} from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";

/**
 * Example workflow test that demonstrates the use of pipe()
 * This workflow will:
 * 1. Take a number
 * 2. Double it
 * 3. Add 5
 * 4. Square the value
 */
describe("Pipeline", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  it("should run the pipe()", async () => {
    // Create our tasks
    const doubleTask = new DoubleTask({ defaults: { value: 3 } });
    const addFiveTask = new AddFiveTask();
    const squareTask = new SquareTask();
    // Create the workflow using pipe()
    const workflow = pipe([doubleTask, addFiveTask, squareTask]);

    // Run the workflow with input
    const value = await workflow.run({ value: 3 });

    // Expected value:
    // 1. Double 3 = 6
    // 2. Add 5 = 11
    // 3. Square 11 = 121
    // Should output: { value: 121 }
    expect(value).toEqual({ value: 121 });
  });

  it("should run the workflow.pipe()", async () => {
    // Create our tasks
    const doubleTask = new DoubleTask({ defaults: { value: 3 } });
    const addFiveTask = new AddFiveTask();
    const squareTask = new SquareTask();
    // Create the workflow using pipe()
    const cache = new InMemoryTaskOutputRepository();
    const workflow = new Workflow<{ value: number }, { value: number }>(cache);
    workflow.pipe(doubleTask, addFiveTask, squareTask);

    // Run the workflow with input
    const value = await workflow.run({ value: 3 });

    // Expected value:
    // 1. Double 3 = 6
    // 2. Add 5 = 11
    // 3. Square 11 = 121
    // Should output: { value: 121 }
    expect(value).toEqual({ value: 121 });

    const valueAgain = await workflow.run({ value: 3 });
    expect(valueAgain).toEqual({ value: 121 });
  });
});
