/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { AiEmit } from "../capability/AiEmit";
import type { AiJobInput } from "../job/AiJob";
import type { ModelConfig } from "../model/ModelSchema";

/**
 * Strategy for executing AI jobs. Single method: `execute(jobInput, ctx,
 * runnerId, emit)` returns `Promise<void>` and emits all output through
 * `emit`. No accumulation in any implementation.
 */
export interface IAiExecutionStrategy {
  execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined,
    emit: AiEmit<TaskOutput>
  ): Promise<void>;

  abort(): void;
}

export type AiStrategyResolver = (model: ModelConfig) => IAiExecutionStrategy;
