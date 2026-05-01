/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask } from "./ITask";
import type { TaskConfig, TaskInput, TaskOutput } from "./TaskTypes";

/**
 * Interface for TaskRunner
 * Responsible for running tasks and managing their execution lifecycle
 */

export interface ITaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> {
  /**
   * The task being run
   */
  readonly task: ITask<Input, Output, Config>;

  /**
   * Runs the task with the provided input overrides
   * @param overrides Optional input overrides
   */
  run(overrides?: Partial<Input>): Promise<Output>;

  /**
   * Runs the task in preview mode
   * @param overrides Optional input overrides
   */
  runPreview(overrides?: Partial<Input>): Promise<Output>;

  /**
   * Async iterator producing preview outputs as upstream tasks stream
   * snapshots. Yields once immediately with the current preview state, then
   * once per upstream snapshot until all relevant upstream streams complete
   * (or the consumer breaks out of the loop).
   *
   * Watches direct upstream tasks only. Indirect (grandparent) snapshots
   * propagate through chained preview re-runs as upstream parents' values
   * update.
   *
   * Reuses runPreview() under the hood. Errors during a single iteration
   * are caught and skipped — the iterator never throws to the consumer
   * mid-loop.
   */
  runPreviewStream(overrides?: Partial<Input>): AsyncIterable<Output>;

  /**
   * Aborts the task execution
   */
  abort(): void;

  /**
   * Disables the task execution
   */
  disable(): Promise<void>;
}
