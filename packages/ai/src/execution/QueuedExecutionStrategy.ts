/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AbortSignalJobError,
  ConcurrencyLimiter,
  JobQueueClient,
  JobQueueServer,
} from "@workglow/job-queue";
import type { ILimiter } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { getTaskQueueRegistry, TaskConfigurationError } from "@workglow/task-graph";
import type { RegisteredQueue, IExecuteContext, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { StreamEvent } from "@workglow/task-graph";
import { AiJob } from "../job/AiJob";
import type { AiJobInput } from "../job/AiJob";
import type { IAiExecutionStrategy } from "./IAiExecutionStrategy";

/**
 * Executes AI jobs through a job queue with concurrency control.
 * Used by providers that need GPU serialization (e.g., HFT with WebGPU,
 * LlamaCpp).
 *
 * The queue is created lazily on first use and registered in the
 * global TaskQueueRegistry for deduplication.
 */
export class QueuedExecutionStrategy implements IAiExecutionStrategy {
  /**
   * Memoized initialization promise so that concurrent calls to ensureQueue()
   * within the same strategy instance share a single queue-creation flow.
   */
  private initPromise: Promise<RegisteredQueue<AiJobInput<TaskInput>, TaskOutput>> | null = null;

  /**
   * Shared limiter used by both the underlying JobQueueServer (for `execute`)
   * and `executeStream` below. Created lazily in createQueue() and reused so
   * streaming calls compete for the same concurrency slots as queued jobs.
   */
  private limiter: ILimiter | undefined;

  constructor(
    private readonly queueName: string,
    private readonly concurrency: number = 1,
    /**
     * When false, the strategy will use a pre-registered queue and throw if
     * none exists. When true (default), it auto-creates the queue on first use.
     */
    private readonly autoCreate: boolean = true
  ) {}

  async execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined
  ): Promise<TaskOutput> {
    // Bail early to avoid submitting a job that's already been cancelled.
    if (context.signal.aborted) {
      throw context.signal.reason ?? new AbortSignalJobError("The operation was aborted");
    }

    const registeredQueue = await this.ensureQueue();
    const { client } = registeredQueue;

    const handle = await client.submit(jobInput, {
      jobRunId: runnerId,
      maxRetries: 10,
    });

    // Wire the task abort signal to the queued job so that aborting the task
    // (e.g., via TaskRunner timeout) also cancels the in-flight queue job.
    const onAbort = () => {
      handle.abort().catch((err) => {
        console.warn(`Failed to abort queued job`, err);
      });
    };
    context.signal.addEventListener("abort", onAbort);

    const cleanupProgress = handle.onProgress(
      (progress: number, message: string | undefined, details: Record<string, any> | null) => {
        context.updateProgress(progress, message, details);
      }
    );

    try {
      // Re-check after registering the listener to close the race window
      // between submit and listener registration.
      if (context.signal.aborted) {
        throw context.signal.reason ?? new AbortSignalJobError("The operation was aborted");
      }
      const output = await handle.waitFor();
      return output as TaskOutput;
    } finally {
      cleanupProgress();
      context.signal.removeEventListener("abort", onAbort);
    }
  }

  abort(): void {
    // No-op — abort is handled via the AbortSignal wired in execute().
  }

  /**
   * Streaming execution for queued providers. Runs the provider's stream
   * function directly (bypassing the storage-backed queue, which can't
   * forward mid-stream events) while still acquiring a slot from the same
   * concurrency limiter the queue uses — so GPU serialization is preserved.
   *
   * AiJob.executeStream handles worker-proxy lookup, abort wiring, timeouts,
   * and error classification; we just gate it through the limiter.
   */
  async *executeStream(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined
  ): AsyncIterable<StreamEvent<TaskOutput>> {
    if (context.signal.aborted) {
      throw context.signal.reason ?? new AbortSignalJobError("The operation was aborted");
    }

    // Ensure the queue (and thus the shared limiter) has been created.
    await this.ensureQueue();
    const limiter = this.limiter;
    if (!limiter) {
      throw new TaskConfigurationError(
        `QueuedExecutionStrategy: limiter was not initialized for queue "${this.queueName}"`
      );
    }

    await this.acquireLimiterSlot(limiter, context.signal);

    try {
      const job = new AiJob({
        queueName: jobInput.aiProvider,
        jobRunId: runnerId,
        input: jobInput,
      });

      yield* job.executeStream(jobInput, {
        signal: context.signal,
        updateProgress: context.updateProgress,
      });
    } finally {
      // The token was inserted by acquireLimiterSlot; we don't carry it
      // through here because the queue's own AiJob/limiter lifecycle owns the
      // matching release/recordJobCompletion. recordJobCompletion remains the
      // contract for "this job finished" — token-based release is only for
      // rolling back an unused acquisition.
      await limiter.recordJobCompletion();
    }
  }

  /**
   * Atomically acquire a limiter slot, retrying with backoff until success or
   * abort. Uses {@link ILimiter.tryAcquire} so concurrent callers cannot both
   * pass a check-then-record sequence and overshoot the configured limit.
   */
  private async acquireLimiterSlot(limiter: ILimiter, signal: AbortSignal): Promise<void> {
    let token = await limiter.tryAcquire();
    while (token === null || token === undefined) {
      if (signal.aborted) {
        throw signal.reason ?? new AbortSignalJobError("The operation was aborted");
      }
      const next = await limiter.getNextAvailableTime();
      const delay = Math.max(0, next.getTime() - Date.now());
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delay, 50)));
      token = await limiter.tryAcquire();
    }
    // Token discarded — the surrounding finally calls recordJobCompletion()
    // on the happy path. If acquire-then-throw happens after this returns,
    // the outer try/finally would leak a slot until the rate-limit window
    // rolls — acceptable here since the AiJob path is single-use per call.
    void token;
  }

  private ensureQueue(): Promise<RegisteredQueue<AiJobInput<TaskInput>, TaskOutput>> {
    if (!this.initPromise) {
      this.initPromise = this.createQueue().catch((err) => {
        // Reset so next execution retries (e.g., transient storage error or late queue registration).
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async createQueue(): Promise<RegisteredQueue<AiJobInput<TaskInput>, TaskOutput>> {
    const registry = getTaskQueueRegistry();
    const existing = registry.getQueue<AiJobInput<TaskInput>, TaskOutput>(this.queueName);
    if (existing) {
      if (!existing.server.isRunning()) {
        await existing.server.start();
      }
      this.limiter = existing.server.limiter;
      return existing;
    }

    if (!this.autoCreate) {
      throw new TaskConfigurationError(
        `Queue "${this.queueName}" is not registered and autoCreate is disabled. ` +
          `Register the queue before executing tasks with this provider.`
      );
    }

    const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(this.queueName);
    await storage.setupDatabase();

    this.limiter = new ConcurrencyLimiter(this.concurrency);
    const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob, {
      storage,
      queueName: this.queueName,
      limiter: this.limiter,
    });

    const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
      storage,
      queueName: this.queueName,
    });

    client.attach(server);

    const registeredQueue: RegisteredQueue<AiJobInput<TaskInput>, TaskOutput> = {
      server,
      client,
      storage,
    };

    try {
      registry.registerQueue(registeredQueue);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("already exists")) {
        // Another strategy instance won the race; use its queue. Stop the server
        // we just created (safe no-op since it was never started) to release any
        // resources eagerly, and drop our references so they can be GC'd.
        server.stop().catch((stopErr) => {
          console.warn("QueuedExecutionStrategy: failed to stop raced-out queue server", stopErr);
        });
        const raced = registry.getQueue<AiJobInput<TaskInput>, TaskOutput>(this.queueName);
        if (raced) {
          if (!raced.server.isRunning()) {
            await raced.server.start();
          }
          this.limiter = raced.server.limiter;
          return raced;
        }
      }
      throw err;
    }

    await server.start();
    return registeredQueue;
  }
}
