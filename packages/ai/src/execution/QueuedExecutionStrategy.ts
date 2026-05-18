/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ILimiter } from "@workglow/job-queue";
import { AbortSignalJobError, ConcurrencyLimiter } from "@workglow/job-queue";
import type { IExecuteContext, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { AiEmit } from "../capability/AiEmit";
import type { AiJobInput } from "../job/AiJob";
import { AiJob } from "../job/AiJob";
import type { IAiExecutionStrategy } from "./IAiExecutionStrategy";

/**
 * Queued execution: acquires a slot from a shared {@link ConcurrencyLimiter}
 * so GPU-serialized providers (HFT WebGPU, LlamaCpp) don't run more than the
 * configured concurrency in parallel. Releases the slot when the job
 * completes.
 *
 * Unlike the previous implementation, this strategy does **not** use a
 * storage-backed JobQueue. The new run-fn shape emits events through the
 * dispatch chain; storage queues can't carry mid-stream events. If
 * retry/persistence semantics are needed for a particular provider, that's
 * a separate strategy added later — this one is for in-task concurrency
 * control only.
 */
export class QueuedExecutionStrategy implements IAiExecutionStrategy {
  private limiter: ILimiter | undefined;

  /**
   * @param concurrency Maximum number of in-flight jobs across the shared
   *   limiter.
   */
  constructor(private readonly concurrency: number = 1) {}

  async execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined,
    emit: AiEmit<TaskOutput>
  ): Promise<void> {
    if (context.signal.aborted) {
      throw context.signal.reason ?? new AbortSignalJobError("The operation was aborted");
    }

    if (!this.limiter) {
      this.limiter = new ConcurrencyLimiter(this.concurrency);
    }
    const limiter = this.limiter;
    const token = await this.acquireLimiterSlot(limiter, context.signal);

    try {
      const job = new AiJob({
        queueName: jobInput.aiProvider,
        jobRunId: runnerId,
        input: jobInput,
      });
      await job.execute(
        jobInput,
        { signal: context.signal, updateProgress: context.updateProgress },
        emit
      );
    } finally {
      await limiter.complete(token);
    }
  }

  abort(): void {
    // No-op — abort flows through context.signal.
  }

  /**
   * Atomically acquire a limiter slot, retrying with backoff until success or
   * abort. Uses {@link ILimiter.tryAcquire} so concurrent callers cannot both
   * pass a check-then-record sequence and overshoot the configured limit.
   */
  private async acquireLimiterSlot(limiter: ILimiter, signal: AbortSignal): Promise<unknown> {
    let token = await limiter.tryAcquire();
    while (token === null || token === undefined) {
      if (signal.aborted) {
        throw signal.reason ?? new AbortSignalJobError("The operation was aborted");
      }
      const next = await limiter.getNextAvailableTime();
      const delay = Math.max(0, next.getTime() - Date.now());
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(20, Math.min(delay, 200))));
      token = await limiter.tryAcquire();
    }
    return token;
  }
}
