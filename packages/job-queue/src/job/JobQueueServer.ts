/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter, getLogger } from "@workglow/util";
import { ILimiter } from "../limiter/ILimiter";
import { NullLimiter } from "../limiter/NullLimiter";
import type { IJobStore } from "../queue-storage/IJobStore";
import type { IMessageQueue } from "../queue-storage/IMessageQueue";
import type {
  IQueueStorage,
  JobStorageFormat,
  QueueChangePayload,
} from "../queue-storage/IQueueStorage";
import { JobStatus } from "../queue-storage/IQueueStorage";
import { wrapQueueStorage } from "../queue-storage/wrapQueueStorage";
import type { DeadLetter } from "./DeadLetter";
import { Job, JobClass } from "./Job";
import { JobQueueClient } from "./JobQueueClient";
import { JobQueueWorker } from "./JobQueueWorker";
import { classToStorage, storageToClass } from "./JobStorageConverters";

/**
 * Statistics tracked for the job queue
 */
export interface JobQueueStats {
  readonly totalJobs: number;
  readonly completedJobs: number;
  readonly failedJobs: number;
  readonly abortedJobs: number;
  readonly retriedJobs: number;
  readonly disabledJobs: number;
  readonly averageProcessingTime?: number;
  readonly lastUpdateTime: Date;
}

/**
 * Events emitted by JobQueueServer
 */
export type JobQueueServerEventListeners<Input, Output> = {
  server_start: (queueName: string) => void;
  server_stop: (queueName: string) => void;
  job_start: (queueName: string, jobId: unknown) => void;
  job_complete: (queueName: string, jobId: unknown, output: Output) => void;
  job_error: (queueName: string, jobId: unknown, error: string) => void;
  job_disabled: (queueName: string, jobId: unknown) => void;
  job_retry: (queueName: string, jobId: unknown, visibleAt: Date) => void;
  job_progress: (
    queueName: string,
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, unknown> | null
  ) => void;
};

export type JobQueueServerEvents = keyof JobQueueServerEventListeners<unknown, unknown>;

/**
 * Options for creating a JobQueueServer
 */
export interface JobQueueServerOptions<Input, Output> {
  /**
   * Legacy single-storage option. Provide either `storage` OR the paired
   * `messageQueue`+`jobStore`. When `storage` is given it is wrapped via
   * {@link wrapQueueStorage} internally.
   */
  readonly storage?: IQueueStorage<Input, Output>;
  readonly messageQueue?: IMessageQueue<JobStorageFormat<Input, Output>>;
  readonly jobStore?: IJobStore<Input, Output>;
  readonly queueName: string;
  readonly limiter?: ILimiter;
  readonly workerCount?: number;
  readonly pollIntervalMs?: number;
  readonly deleteAfterCompletionMs?: number;
  readonly deleteAfterFailureMs?: number;
  readonly deleteAfterDisabledMs?: number;
  readonly cleanupIntervalMs?: number;
  /**
   * Max time each worker's `stop()` waits for in-flight jobs before forcing aborts.
   * Defaults to 30s. Set to 0 to abort immediately.
   */
  readonly stopTimeoutMs?: number;
  /**
   * Dead-letter queue to forward exhausted jobs to, or "discard" to silently drop them.
   * Default: "discard".
   */
  readonly deadLetter?: IMessageQueue<DeadLetter<Input>> | "discard";
  /** Number of jobs to pre-fetch per poll iteration. Defaults to 1. */
  readonly prefetch?: number;
}

/**
 * Server that coordinates multiple workers and manages the job queue lifecycle.
 * Handles stuck job recovery, cleanup, and aggregates statistics.
 */
export class JobQueueServer<
  Input,
  Output,
  QueueJob extends Job<Input, Output> = Job<Input, Output>,
> {
  public readonly queueName: string;
  protected readonly messageQueue: IMessageQueue<JobStorageFormat<Input, Output>>;
  protected readonly jobStore: IJobStore<Input, Output>;
  /** Optional legacy storage handle, set when the user constructed via `storage`. */
  protected readonly storage: IQueueStorage<Input, Output> | null;
  protected readonly jobClass: JobClass<Input, Output>;
  public readonly limiter: ILimiter;
  protected readonly workerCount: number;
  protected readonly pollIntervalMs: number;
  protected readonly deleteAfterCompletionMs?: number;
  protected readonly deleteAfterFailureMs?: number;
  protected readonly deleteAfterDisabledMs?: number;
  protected readonly cleanupIntervalMs: number;
  protected readonly stopTimeoutMs?: number;
  protected readonly deadLetter: IMessageQueue<DeadLetter<Input>> | "discard";
  protected readonly prefetch: number;

  protected readonly events = new EventEmitter<JobQueueServerEventListeners<Input, Output>>();
  protected readonly workers: JobQueueWorker<Input, Output, QueueJob>[] = [];
  protected readonly clients: Set<JobQueueClient<Input, Output>> = new Set();

  protected running = false;
  protected cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  protected storageUnsubscribe: (() => void) | null = null;

  protected stats: JobQueueStats = {
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    abortedJobs: 0,
    retriedJobs: 0,
    disabledJobs: 0,
    lastUpdateTime: new Date(),
  };

  constructor(jobClass: JobClass<Input, Output>, options: JobQueueServerOptions<Input, Output>) {
    this.queueName = options.queueName;
    if (options.messageQueue && options.jobStore) {
      this.messageQueue = options.messageQueue;
      this.jobStore = options.jobStore;
      this.storage = null;
    } else if (options.storage) {
      const wrapped = wrapQueueStorage(options.storage);
      this.messageQueue = wrapped.messageQueue;
      this.jobStore = wrapped.jobStore;
      this.storage = options.storage;
    } else {
      throw new Error(
        "JobQueueServer requires either `storage` or both `messageQueue` and `jobStore`"
      );
    }
    this.jobClass = jobClass;
    this.limiter = options.limiter ?? new NullLimiter();
    this.workerCount = options.workerCount ?? 1;
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.deleteAfterCompletionMs = options.deleteAfterCompletionMs;
    this.deleteAfterFailureMs = options.deleteAfterFailureMs;
    this.deleteAfterDisabledMs = options.deleteAfterDisabledMs;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 10000;
    this.stopTimeoutMs = options.stopTimeoutMs;
    this.deadLetter = options.deadLetter ?? "discard";
    this.prefetch = Math.max(1, options.prefetch ?? 1);

    this.initializeWorkers();
  }

  /**
   * Start the server and all workers
   */
  public async start(): Promise<this> {
    if (this.running) {
      return this;
    }

    this.running = true;
    this.events.emit("server_start", this.queueName);

    // Warn when a process-scoped limiter is paired with a cluster-scoped
    // queue storage. The user almost certainly meant their configured limit
    // to be enforced cluster-wide; with a process-scoped limiter they get
    // N× the limit (one bucket per process).
    if (
      this.limiter.scope === "process" &&
      this.messageQueue.scope === "cluster" &&
      !(this.limiter instanceof NullLimiter)
    ) {
      getLogger().warn(
        "Process-scoped limiter on cluster-scoped queue storage — limit is enforced per-process, not cluster-wide. Use a cluster-scoped rate limiter storage (Postgres/Supabase) for global enforcement.",
        {
          queueName: this.queueName,
          limiterScope: this.limiter.scope,
          storage: this.storage?.constructor.name ?? this.messageQueue.constructor.name,
        }
      );
    }

    // Subscribe to storage changes to wake workers when new work arrives.
    // - Cross-process deployments rely on this for wake-up.
    // - Same-process attached clients are also primarily woken by the direct
    //   `handleJobAdded` path on submit, but we keep the subscription as a
    //   correctness backstop: some async backends (e.g. fake-indexeddb under
    //   bun) have read-after-write visibility lag where a just-committed job
    //   isn't yet returned by `storage.next()`. The subscription fires only
    //   after the write is visible to readers, providing a guaranteed wake.
    // - Sqlite/Postgres throw here; the try/catch falls through and direct
    //   notify is the sole wake path on those backends.
    try {
      const sub = this.messageQueue.subscribeToChanges;
      if (!sub) throw new Error("messageQueue does not support subscribeToChanges");
      this.storageUnsubscribe = sub.call(
        this.messageQueue,
        (change: QueueChangePayload<Input, Output>) => {
          if (
            change.type === "INSERT" ||
            change.type === "RESYNC" ||
            (change.type === "UPDATE" && change.new?.status === JobStatus.PENDING)
          ) {
            this.notifyWorkers();
          }
        }
      );
    } catch (err) {
      // Storage doesn't support change subscriptions — workers will poll.
      // Logged at debug because Sqlite/Postgres throw here by design; an
      // unexpected throw on a storage that *should* support subscriptions
      // (e.g. misconfigured Supabase realtime) is otherwise silent.
      getLogger().debug("subscribeToChanges unsupported on this storage", {
        queueName: this.queueName,
        error: err,
      });
    }

    // Start all workers
    await Promise.all(this.workers.map((worker) => worker.start()));

    // Start cleanup loop only if at least one retention TTL is configured.
    if (this.hasRetentionTtls()) {
      this.startCleanupLoop();
    }

    return this;
  }

  /**
   * True if any delete-after-X TTL is set to a positive value.
   * When false, the cleanup loop would be a pure no-op and is skipped.
   */
  private hasRetentionTtls(): boolean {
    return (
      (this.deleteAfterCompletionMs !== undefined && this.deleteAfterCompletionMs > 0) ||
      (this.deleteAfterFailureMs !== undefined && this.deleteAfterFailureMs > 0) ||
      (this.deleteAfterDisabledMs !== undefined && this.deleteAfterDisabledMs > 0)
    );
  }

  /**
   * Stop the server and all workers
   */
  public async stop(): Promise<this> {
    if (!this.running) {
      return this;
    }

    this.running = false;

    // Unsubscribe from storage changes
    if (this.storageUnsubscribe) {
      this.storageUnsubscribe();
      this.storageUnsubscribe = null;
    }

    // Stop cleanup loop
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop all workers
    await Promise.all(this.workers.map((worker) => worker.stop()));

    this.events.emit("server_stop", this.queueName);
    return this;
  }

  /**
   * Get the current queue statistics
   */
  public getStats(): JobQueueStats {
    return { ...this.stats };
  }

  /**
   * Get the storage instance (for client connection)
   */
  public getStorage(): IQueueStorage<Input, Output> | null {
    return this.storage;
  }

  /** Get the message queue paired with this server. */
  public getMessageQueue(): IMessageQueue<JobStorageFormat<Input, Output>> {
    return this.messageQueue;
  }

  /** Get the job store paired with this server. */
  public getJobStore(): IJobStore<Input, Output> {
    return this.jobStore;
  }

  /**
   * Scale the number of workers
   */
  public async scaleWorkers(count: number): Promise<void> {
    if (count < 1) {
      throw new Error("Worker count must be at least 1");
    }

    const currentCount = this.workers.length;

    if (count > currentCount) {
      // Add more workers
      for (let i = currentCount; i < count; i++) {
        const worker = this.createWorker();
        this.workers.push(worker);
        if (this.running) {
          await worker.start();
        }
      }
    } else if (count < currentCount) {
      // Remove workers
      const toRemove = this.workers.splice(count);
      await Promise.all(toRemove.map((worker) => worker.stop()));
    }
  }

  /**
   * Check if the server is running
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the number of workers
   */
  public getWorkerCount(): number {
    return this.workers.length;
  }

  // ========================================================================
  // Client management
  // ========================================================================

  /**
   * Add a client for same-process event forwarding
   * @internal
   */
  public addClient(client: JobQueueClient<Input, Output>): void {
    this.clients.add(client);
  }

  /**
   * Remove a client
   * @internal
   */
  public removeClient(client: JobQueueClient<Input, Output>): void {
    this.clients.delete(client);
  }

  /**
   * Wake all idle workers so they check for new jobs immediately.
   * @internal
   */
  public notifyWorkers(): void {
    for (const worker of this.workers) {
      worker.notify();
    }
  }

  /**
   * Called by an attached client immediately after a job is inserted into storage,
   * so the worker can pick it up without waiting for the poll interval.
   * @internal
   */
  public handleJobAdded(_jobId: unknown): void {
    this.notifyWorkers();
  }

  /**
   * Fire the abort controller for the given job on whichever worker is running it.
   * Returns true if any worker handled the abort locally.
   * @internal
   */
  public abortJob(jobId: unknown): boolean {
    for (const worker of this.workers) {
      if (worker.requestAbort(jobId)) {
        return true;
      }
    }
    return false;
  }

  // ========================================================================
  // Event handling
  // ========================================================================

  public on<Event extends JobQueueServerEvents>(
    event: Event,
    listener: JobQueueServerEventListeners<Input, Output>[Event]
  ): void {
    this.events.on(event, listener);
  }

  public off<Event extends JobQueueServerEvents>(
    event: Event,
    listener: JobQueueServerEventListeners<Input, Output>[Event]
  ): void {
    this.events.off(event, listener);
  }

  // ========================================================================
  // Protected methods
  // ========================================================================

  /**
   * Initialize workers
   */
  protected initializeWorkers(): void {
    for (let i = 0; i < this.workerCount; i++) {
      const worker = this.createWorker();
      this.workers.push(worker);
    }
  }

  /**
   * Create a new worker and wire up event forwarding
   */
  protected createWorker(): JobQueueWorker<Input, Output, QueueJob> {
    const worker = new JobQueueWorker<Input, Output, QueueJob>(this.jobClass, {
      messageQueue: this.messageQueue,
      jobStore: this.jobStore,
      queueName: this.queueName,
      limiter: this.limiter,
      pollIntervalMs: this.pollIntervalMs,
      stopTimeoutMs: this.stopTimeoutMs,
      deadLetter: this.deadLetter,
      prefetch: this.prefetch,
    });

    // Forward worker events to server and clients
    worker.on("job_start", (jobId) => {
      this.stats = { ...this.stats, totalJobs: this.stats.totalJobs + 1 };
      this.events.emit("job_start", this.queueName, jobId);
      this.forwardToClients("handleJobStart", jobId);
    });

    worker.on("job_complete", (jobId, output) => {
      this.stats = { ...this.stats, completedJobs: this.stats.completedJobs + 1 };
      this.updateAverageProcessingTime();
      this.events.emit("job_complete", this.queueName, jobId, output);
      this.forwardToClients("handleJobComplete", jobId, output);

      // Immediate deletion when configured
      if (this.deleteAfterCompletionMs === 0) {
        this.jobStore.delete(jobId).catch((err) => {
          console.error("Error deleting job after completion:", err);
        });
      }

      // A concurrency slot freed up — wake idle workers
      this.notifyWorkers();
    });

    worker.on("job_error", (jobId, error, errorCode) => {
      this.stats = { ...this.stats, failedJobs: this.stats.failedJobs + 1 };
      this.events.emit("job_error", this.queueName, jobId, error);
      this.forwardToClients("handleJobError", jobId, error, errorCode);

      // Immediate deletion when configured
      if (this.deleteAfterFailureMs === 0) {
        this.jobStore.delete(jobId).catch((err) => {
          console.error("Error deleting job after error:", err);
        });
      }

      // A concurrency slot freed up — wake idle workers
      this.notifyWorkers();
    });

    worker.on("job_disabled", (jobId) => {
      this.stats = { ...this.stats, disabledJobs: this.stats.disabledJobs + 1 };
      this.events.emit("job_disabled", this.queueName, jobId);
      this.forwardToClients("handleJobDisabled", jobId);

      // Immediate deletion when configured
      if (this.deleteAfterDisabledMs === 0) {
        this.jobStore.delete(jobId).catch((err) => {
          console.error("Error deleting job after disabling:", err);
        });
      }

      // A concurrency slot freed up — wake idle workers
      this.notifyWorkers();
    });

    worker.on("job_retry", (jobId, visibleAt) => {
      this.stats = { ...this.stats, retriedJobs: this.stats.retriedJobs + 1 };
      this.events.emit("job_retry", this.queueName, jobId, visibleAt);
      this.forwardToClients("handleJobRetry", jobId, visibleAt);
    });

    worker.on("job_progress", (jobId, progress, message, details) => {
      this.events.emit("job_progress", this.queueName, jobId, progress, message, details);
      this.forwardToClients("handleJobProgress", jobId, progress, message, details);
    });

    return worker;
  }

  /**
   * Forward events to all attached clients
   */
  protected forwardToClients(method: "handleJobStart", jobId: unknown): void;
  protected forwardToClients(method: "handleJobComplete", jobId: unknown, output: Output): void;
  protected forwardToClients(
    method: "handleJobError",
    jobId: unknown,
    error: string,
    errorCode?: string
  ): void;
  protected forwardToClients(method: "handleJobDisabled", jobId: unknown): void;
  protected forwardToClients(method: "handleJobRetry", jobId: unknown, visibleAt: Date): void;
  protected forwardToClients(
    method: "handleJobProgress",
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, unknown> | null
  ): void;
  protected forwardToClients(method: string, ...args: unknown[]): void {
    for (const client of this.clients) {
      const fn = (client as any)[method];
      if (typeof fn === "function") {
        fn.apply(client, args);
      }
    }
  }

  /**
   * Update average processing time from all workers
   */
  protected updateAverageProcessingTime(): void {
    const times: number[] = [];
    for (const worker of this.workers) {
      const avgTime = worker.getAverageProcessingTime();
      if (avgTime !== undefined) {
        times.push(avgTime);
      }
    }
    if (times.length > 0) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      this.stats = {
        ...this.stats,
        averageProcessingTime: avg,
        lastUpdateTime: new Date(),
      };
    }
  }

  /**
   * Start the cleanup loop
   */
  protected startCleanupLoop(): void {
    if (!this.running) return;

    this.cleanupJobs().finally(() => {
      if (this.running) {
        this.cleanupTimer = setTimeout(() => this.startCleanupLoop(), this.cleanupIntervalMs);
      }
    });
  }

  /**
   * Clean up completed/failed jobs based on TTL settings
   */
  protected async cleanupJobs(): Promise<void> {
    try {
      // The workers will handle the abort via their abort controllers
      // We just need to ensure the jobs get marked as failed

      // Delete completed jobs after TTL
      if (this.deleteAfterCompletionMs !== undefined && this.deleteAfterCompletionMs > 0) {
        await this.jobStore.deleteByStatusAndAge(JobStatus.COMPLETED, this.deleteAfterCompletionMs);
      }

      // Delete failed jobs after TTL
      if (this.deleteAfterFailureMs !== undefined && this.deleteAfterFailureMs > 0) {
        await this.jobStore.deleteByStatusAndAge(JobStatus.FAILED, this.deleteAfterFailureMs);
      }

      // Delete disabled jobs after TTL
      if (this.deleteAfterDisabledMs !== undefined && this.deleteAfterDisabledMs > 0) {
        await this.jobStore.deleteByStatusAndAge(JobStatus.DISABLED, this.deleteAfterDisabledMs);
      }
    } catch (error) {
      console.error("Error in cleanup:", error);
    }
  }

  /**
   * Convert storage format to Job class
   */
  protected storageToClass(details: JobStorageFormat<Input, Output>): Job<Input, Output> {
    return storageToClass(details, this.jobClass);
  }

  /**
   * Convert Job class to storage format
   */
  protected classToStorage(job: Job<Input, Output>): JobStorageFormat<Input, Output> {
    return classToStorage(job, this.queueName);
  }
}
