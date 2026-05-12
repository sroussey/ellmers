/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { AiEmit } from "../capability/AiEmit";
import { AiJob } from "../job/AiJob";
import type { AiJobInput } from "../job/AiJob";
import type { IAiExecutionStrategy } from "./IAiExecutionStrategy";

/**
 * Direct (no queue) execution for API providers and local providers that
 * don't need GPU serialization. Forwards `emit` straight to the AiJob's
 * run-fn dispatch.
 */
export class DirectExecutionStrategy implements IAiExecutionStrategy {
  async execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined,
    emit: AiEmit<TaskOutput>
  ): Promise<void> {
    const job = new AiJob({
      queueName: jobInput.aiProvider,
      jobRunId: runnerId,
      input: jobInput,
    });

    const cleanup = job.onJobProgress(
      (progress: number, message: string, details: Record<string, any> | null) => {
        context.updateProgress(progress, message, details);
      }
    );

    try {
      await job.execute(
        jobInput,
        { signal: context.signal, updateProgress: context.updateProgress },
        emit
      );
    } finally {
      cleanup();
    }
  }

  abort(): void {
    // No-op — abort flows through context.signal.
  }
}
