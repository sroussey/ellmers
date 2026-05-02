/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphAsTaskRunner } from "./GraphAsTaskRunner";
import type { TaskRunContext } from "./TaskRunContext";
import type { TaskInput, TaskOutput } from "./TaskTypes";
import type { WhileTask, WhileTaskConfig } from "./WhileTask";

/**
 * Runner for WhileTask that delegates to the task's execute() method
 * instead of directly running the subgraph once (which is what
 * GraphAsTaskRunner does by default).
 *
 * This follows the same pattern as IteratorTaskRunner.
 */
export class WhileTaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends WhileTaskConfig<Input, Output> = WhileTaskConfig<Input, Output>,
> extends GraphAsTaskRunner<Input, Output, Config> {
  declare task: WhileTask<Input, Output, Config>;

  /**
   * Override executeTask to call the task's execute() method which
   * contains the while-loop logic, rather than the default
   * GraphAsTaskRunner behavior of running the subgraph once.
   */
  protected override async executeTask(
    input: Input,
    ctx: TaskRunContext
  ): Promise<Output | undefined> {
    const result = await this.task.execute(input, {
      signal: ctx.abortController.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
    });

    return result;
  }

  /**
   * For WhileTask, preview runs use the task's preview hook only.
   */
  public override async executeTaskPreview(
    input: Input,
    _ctx: TaskRunContext
  ): Promise<Output | undefined> {
    return this.task.executePreview?.(input, { own: this.own });
  }
}
