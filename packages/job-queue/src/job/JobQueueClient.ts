/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_LIMITS, EventEmitter, getLogger } from "@workglow/util";
import type { IJobStore } from "../queue-storage/IJobStore";
import type { IMessageQueue } from "../queue-storage/IMessageQueue";
import type { JobStorageFormat, QueueChangePayload } from "../queue-storage/IQueueStorage";
import { JobStatus } from "../queue-storage/IQueueStorage";
import { Job } from "./Job";
import {
  AbortSignalJobError,
  JobDisabledError,
  JobError,
  JobNotFoundError,
  PermanentJobError,
  RetryableJobError,
} from "./JobError";
import { applyPersistedDiagnosticsToStack } from "./JobErrorDiagnostics";
import { lookupErrorCodeReconstructor } from "./JobErrorRegistry";
import {
  JobProgressListener,
  JobQueueEventListener,
  JobQueueEventListeners,
  JobQueueEventParameters,
  JobQueueEvents,
} from "./JobQueueEventListeners";
import type { JobQueueServer } from "./JobQueueServer";
import { storageToClass } from "./JobStorageConverters";

/**
 * Handle returned when submitting a job, providing methods to interact with the job
 */
export interface JobHandle<Output> {
  readonly id: unknown;
  waitFor(): Promise<Output>;
  abort(): Promise<void>;
  onProgress(callback: JobProgressListener): () => void;
}

/**
 * Options for creating a JobQueueClient
 */
export interface JobQueueClientOptions<Input, Output> {
  readonly messageQueue: IMessageQueue<JobStorageFormat<Input, Output>>;
  readonly jobStore: IJobStore<Input, Output>;
  readonly queueName: string;
}

/**
 * Client for submitting jobs and monitoring their progress.
 * Connect to a JobQueueServer for same-process optimization,
 * or use storage subscriptions for cross-process communication.
 */
export class JobQueueClient<Input, Output> {
  public readonly queueName: string;
  protected readonly messageQueue: IMessageQueue<JobStorageFormat<Input, Output>>;
  protected readonly jobStore: IJobStore<Input, Output>;
  protected readonly events = new EventEmitter<JobQueueEventListeners<Input, Output>>();
  protected server: JobQueueServer<Input, Output> | null = null;
  protected storageUnsubscribe: (() => void) | null = null;

  /**
   * Map of job IDs to their pending promise resolvers
   */
  protected readonly activeJobPromises: Map<
    unknown,
    Array<{
      resolve: (value: Output) => void;
      reject: (err: JobError) => void;
    }>
  > = new Map();

  /**
   * Map of job IDs to their progress listeners
   */
  protected readonly jobProgressListeners: Map<unknown, Set<JobProgressListener>> = new Map();

  /**
   * Last known progress state for each job
   */
  protected readonly lastKnownProgress: Map<
    unknown,
    {
      readonly progress: number;
      readonly message: string;
      readonly details: Record<string, unknown> | null;
    }
  > = new Map();

  constructor(options: JobQueueClientOptions<Input, Output>) {
    this.queueName = options.queueName;
    this.messageQueue = options.messageQueue;
    this.jobStore = options.jobStore;
  }

  /**
   * Attach to a local JobQueueServer for same-process event optimization.
   * When attached, events flow directly from server without storage polling.
   */
  public attach(server: JobQueueServer<Input, Output>): void {
    if (this.server) {
      this.detach();
    }
    this.server = server;
    server.addClient(this);

    // Unsubscribe from storage if we were using it
    if (this.storageUnsubscribe) {
      this.storageUnsubscribe();
      this.storageUnsubscribe = null;
    }
  }

  /**
   * Detach from the current server
   */
  public detach(): void {
    if (this.server) {
      this.server.removeClient(this);
      this.server = null;
    }
  }

  /**
   * Connect to storage for cross-process communication (when no local server).
   * Uses storage subscriptions to receive job updates.
   */
  public connect(): void {
    if (this.server) {
      return; // Already connected via server
    }

    if (this.storageUnsubscribe) {
      return; // Already subscribed
    }

    const sub = this.messageQueue.subscribeToChanges;
    if (!sub) return; // backend doesn't support subscriptions
    this.storageUnsubscribe = sub.call(
      this.messageQueue,
      (change: QueueChangePayload<Input, Output>) => {
        this.handleStorageChange(change);
      }
    );
  }

  /**
   * Disconnect from storage subscriptions
   */
  public disconnect(): void {
    if (this.storageUnsubscribe) {
      this.storageUnsubscribe();
      this.storageUnsubscribe = null;
    }
    this.detach();
  }

  /**
   * Send a job to the queue
   */
  public async send(
    input: Input,
    options?: {
      readonly jobRunId?: string;
      readonly fingerprint?: string;
      readonly maxAttempts?: number;
      /** Delay in seconds before the job becomes visible for processing */
      readonly delaySeconds?: number;
      /** Timeout in seconds after which the job deadline is exceeded */
      readonly timeoutSeconds?: number;
    }
  ): Promise<JobHandle<Output>> {
    const job = this.buildJobBody(input, options);

    const id = await this.messageQueue.send(job, {
      fingerprint: options?.fingerprint,
      jobRunId: options?.jobRunId,
      maxAttempts: options?.maxAttempts,
      delaySeconds: options?.delaySeconds,
      timeoutSeconds: options?.timeoutSeconds,
    });

    // Same-process fast path: poke the worker directly so it doesn't have to
    // wait for the poll interval (crucial for Sqlite/Postgres, whose
    // subscribeToChanges throws).
    this.server?.handleJobAdded(id);

    return this.createJobHandle(id);
  }

  /**
   * Send multiple jobs to the queue in a single batched insert.
   *
   * Delegates to {@link IMessageQueue.sendBatch} so N jobs become one storage
   * round-trip and a single worker wake, instead of N inserts + N wakes.
   *
   * Per the {@link IMessageQueue.sendBatch} contract, a batch-wide
   * `fingerprint` is intentionally NOT accepted (it would dedup every body
   * against the first row); use {@link send} per job for fingerprinted dedup.
   * The other options — `jobRunId`, `maxAttempts`, `delaySeconds`,
   * `timeoutSeconds` — apply uniformly to every body and are forwarded (the
   * previous per-item loop silently dropped `delaySeconds`/`timeoutSeconds`).
   */
  public async sendBatch(
    inputs: readonly Input[],
    options?: {
      readonly jobRunId?: string;
      readonly maxAttempts?: number;
      /** Delay in seconds before every job becomes visible for processing */
      readonly delaySeconds?: number;
      /** Timeout in seconds after which every job's deadline is exceeded */
      readonly timeoutSeconds?: number;
    }
  ): Promise<readonly JobHandle<Output>[]> {
    if (inputs.length === 0) return [];

    const bodies = inputs.map((input) => this.buildJobBody(input, options));
    const ids = await this.messageQueue.sendBatch(bodies, {
      jobRunId: options?.jobRunId,
      maxAttempts: options?.maxAttempts,
      delaySeconds: options?.delaySeconds,
      timeoutSeconds: options?.timeoutSeconds,
    });

    // Single wake for the whole batch — avoids the N-wake thundering herd the
    // per-item loop caused.
    this.server?.handleJobAdded(ids[ids.length - 1]);

    return ids.map((id) => this.createJobHandle(id));
  }

  /**
   * Build a {@link JobStorageFormat} body from an input + send options. Shared
   * by {@link send} and {@link sendBatch} so both produce identical rows.
   */
  private buildJobBody(
    input: Input,
    options?: {
      readonly jobRunId?: string;
      readonly fingerprint?: string;
      readonly maxAttempts?: number;
      readonly delaySeconds?: number;
      readonly timeoutSeconds?: number;
    }
  ): JobStorageFormat<Input, Output> {
    return {
      queue: this.queueName,
      input,
      job_run_id: options?.jobRunId,
      fingerprint: options?.fingerprint,
      max_attempts: options?.maxAttempts ?? DEFAULT_LIMITS.jobMaxAttempts,
      visible_at:
        options?.delaySeconds != null
          ? new Date(Date.now() + options.delaySeconds * 1000).toISOString()
          : new Date().toISOString(),
      deadline_at:
        options?.timeoutSeconds != null
          ? new Date(Date.now() + options.timeoutSeconds * 1000).toISOString()
          : null,
      completed_at: null,
      status: JobStatus.PENDING,
    };
  }

  /**
   * Get a job by ID
   */
  public async getJob(id: unknown): Promise<Job<Input, Output> | undefined> {
    if (!id) throw new JobNotFoundError("Cannot get undefined job");
    const job = await this.jobStore.get(id);
    if (!job) return undefined;
    return this.storageToClass(job);
  }

  /**
   * Get jobs by run ID
   */
  public async getJobsByRunId(runId: string): Promise<readonly Job<Input, Output>[]> {
    if (!runId) throw new JobNotFoundError("Cannot get jobs by undefined runId");
    const jobs = await this.jobStore.getByRunId(runId);
    return jobs.map((job) => this.storageToClass(job));
  }

  /**
   * Peek at jobs in the queue
   */
  public async peek(status?: JobStatus, num?: number): Promise<readonly Job<Input, Output>[]> {
    const jobs = await this.jobStore.peek(status, num);
    return jobs.map((job) => this.storageToClass(job));
  }

  /**
   * Get the size of the queue
   */
  public async size(status?: JobStatus): Promise<number> {
    return this.jobStore.size(status);
  }

  /**
   * Get the output for an input (if job completed)
   */
  public async outputForInput(input: Input): Promise<Output | null> {
    if (!input) throw new JobNotFoundError("Cannot get output for undefined input");
    return this.jobStore.outputForInput(input);
  }

  /**
   * Wait for a job to complete.
   *
   * Registers the resolver BEFORE reading storage so that a `handleJobError`
   * / `handleJobComplete` event fired during the storage read isn't dropped
   * on the floor. The previous order (read first, register after) had a
   * TOCTOU window where a fast same-process abort could complete between the
   * read and the registration, leaving `waitFor` to register against an
   * already-finished job and hang forever.
   */
  public async waitFor(jobId: unknown): Promise<Output> {
    if (!jobId) throw new JobNotFoundError("Cannot wait for undefined job");

    const { promise, resolve, reject } = Promise.withResolvers<Output>();
    promise.catch(() => {}); // Prevent unhandled rejection

    const promises = this.activeJobPromises.get(jobId) || [];
    promises.push({ resolve, reject });
    this.activeJobPromises.set(jobId, promises);

    // Now check storage — if the job is already terminal (raced us to it),
    // settle the promise ourselves and clean up the registration. The
    // handler paths (handleJobComplete/Error/Disabled) are idempotent on
    // already-settled promises.
    const job = await this.getJob(jobId);
    if (!job) {
      this.removePromise(jobId, resolve, reject);
      throw new JobNotFoundError(`Job ${jobId} not found`);
    }
    if (job.status === JobStatus.COMPLETED) {
      this.removePromise(jobId, resolve, reject);
      return job.output as Output;
    }
    if (job.status === JobStatus.DISABLED) {
      this.removePromise(jobId, resolve, reject);
      throw new JobDisabledError(`Job ${jobId} was disabled`);
    }
    if (job.status === JobStatus.FAILED) {
      this.removePromise(jobId, resolve, reject);
      throw this.buildErrorFromJob(job);
    }

    return promise;
  }

  private removePromise(
    jobId: unknown,
    resolve: (output: Output) => void,
    reject: (err: unknown) => void
  ): void {
    const list = this.activeJobPromises.get(jobId);
    if (!list) return;
    const idx = list.findIndex((p) => p.resolve === resolve && p.reject === reject);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this.activeJobPromises.delete(jobId);
  }

  /**
   * Abort a job.
   *
   * Same-process path: fires the in-memory abort controller on the attached
   * server — `handleAbort` will write FAILED directly, so we skip the
   * `storage.abort(…)` write. Writing both would race (last-writer-wins) and
   * can leave the row in an inconsistent state on async storages.
   *
   * Cross-process path (or job not currently running on any local worker):
   * write abort_requested_at to storage so the remote worker's poll picks it
   * up (or mark FAILED immediately if the job is still PENDING).
   *
   * Crash window: if the process dies after the in-memory abort fires but
   * before `failJob` writes FAILED, the row stays PROCESSING. Lease expiry
   * in `next()` will re-claim it on the next start so the job will re-run.
   * Make handlers idempotent if that's not acceptable.
   */
  public async abort(jobId: unknown): Promise<void> {
    if (!jobId) throw new JobNotFoundError("Cannot abort undefined job");
    const firedLocally = this.server?.abortJob(jobId) ?? false;
    if (!firedLocally) {
      try {
        await this.jobStore.abort(jobId);
      } finally {
        this.events.emit("job_aborting", this.queueName, jobId);
      }
      return;
    }
    this.events.emit("job_aborting", this.queueName, jobId);
  }

  /**
   * Abort all jobs in a job run
   */
  public async abortJobRun(jobRunId: string): Promise<void> {
    if (!jobRunId) throw new JobNotFoundError("Cannot abort job run with undefined jobRunId");
    const jobs = await this.getJobsByRunId(jobRunId);
    await Promise.allSettled(
      jobs.map((job) => {
        if (job.status === JobStatus.PROCESSING || job.status === JobStatus.PENDING) {
          return this.abort(job.id);
        }
      })
    );
  }

  /**
   * Subscribe to progress updates for a specific job
   */
  public onJobProgress(jobId: unknown, listener: JobProgressListener): () => void {
    if (!this.jobProgressListeners.has(jobId)) {
      this.jobProgressListeners.set(jobId, new Set());
    }
    const listeners = this.jobProgressListeners.get(jobId)!;
    listeners.add(listener);

    return () => {
      const listeners = this.jobProgressListeners.get(jobId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.jobProgressListeners.delete(jobId);
        }
      }
    };
  }

  // ========================================================================
  // Event handling
  // ========================================================================

  public on<Event extends JobQueueEvents>(
    event: Event,
    listener: JobQueueEventListener<Event>
  ): void {
    this.events.on(event, listener);
  }

  public off<Event extends JobQueueEvents>(
    event: Event,
    listener: JobQueueEventListener<Event>
  ): void {
    this.events.off(event, listener);
  }

  public once<Event extends JobQueueEvents>(
    event: Event,
    listener: JobQueueEventListener<Event>
  ): void {
    this.events.once(event, listener);
  }

  public waitOn<Event extends JobQueueEvents>(
    event: Event
  ): Promise<JobQueueEventParameters<Event, Input, Output>> {
    return this.events.waitOn(event) as Promise<JobQueueEventParameters<Event, Input, Output>>;
  }

  /**
   * Subscribes to an event and returns a function to unsubscribe
   * @param event - The event name to subscribe to
   * @param listener - The listener function to add
   * @returns a function to unsubscribe from the event
   */
  public subscribe<Event extends JobQueueEvents>(
    event: Event,
    listener: JobQueueEventListener<Event>
  ): () => void {
    return this.events.subscribe(event, listener);
  }

  // ========================================================================
  // Internal methods called by JobQueueServer for same-process optimization
  // ========================================================================

  /**
   * Called by server when a job starts processing
   * @internal
   */
  public handleJobStart(jobId: unknown): void {
    this.lastKnownProgress.set(jobId, {
      progress: 0,
      message: "",
      details: null,
    });
    this.events.emit("job_start", this.queueName, jobId);
  }

  /**
   * Called by server when a job completes
   * @internal
   */
  public handleJobComplete(jobId: unknown, output: Output): void {
    this.events.emit("job_complete", this.queueName, jobId, output);

    const promises = this.activeJobPromises.get(jobId);
    if (promises) {
      promises.forEach(({ resolve }) => resolve(output));
    }
    this.cleanupJob(jobId);
  }

  /**
   * Called by server when a job fails
   * @internal
   */
  public handleJobError(jobId: unknown, error: string, errorCode?: string): void {
    this.events.emit("job_error", this.queueName, jobId, error);

    const promises = this.activeJobPromises.get(jobId);
    if (promises) {
      const jobError = this.buildErrorFromCode(error, errorCode);
      promises.forEach(({ reject }) => reject(jobError));
    }
    this.cleanupJob(jobId);
  }

  /**
   * Called by server when a job is disabled
   * @internal
   */
  public handleJobDisabled(jobId: unknown): void {
    this.events.emit("job_disabled", this.queueName, jobId);

    const promises = this.activeJobPromises.get(jobId);
    if (promises) {
      promises.forEach(({ reject }) => reject(new JobDisabledError("Job was disabled")));
    }
    this.cleanupJob(jobId);
  }

  /**
   * Called by server when a job is retried
   * @internal
   */
  public handleJobRetry(jobId: unknown, visibleAt: Date): void {
    this.events.emit("job_retry", this.queueName, jobId, visibleAt);
  }

  /**
   * Called by server when job progress updates
   * @internal
   */
  public handleJobProgress(
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, unknown> | null
  ): void {
    this.lastKnownProgress.set(jobId, { progress, message, details });
    this.events.emit("job_progress", this.queueName, jobId, progress, message, details);

    const listeners = this.jobProgressListeners.get(jobId);
    if (listeners) {
      for (const listener of listeners) {
        listener(progress, message, details);
      }
    }
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private createJobHandle(id: unknown): JobHandle<Output> {
    return {
      id,
      waitFor: () => this.waitFor(id),
      abort: () => this.abort(id),
      onProgress: (callback: JobProgressListener) => this.onJobProgress(id, callback),
    };
  }

  private cleanupJob(jobId: unknown): void {
    this.activeJobPromises.delete(jobId);
    this.lastKnownProgress.delete(jobId);
    this.jobProgressListeners.delete(jobId);
  }

  private handleStorageChange(change: QueueChangePayload<Input, Output>): void {
    if (!change.new && !change.old) return;

    const jobId = change.new?.id ?? change.old?.id;
    if (!jobId) return;

    // Only process changes for our queue
    const queueName = change.new?.queue ?? change.old?.queue;
    if (queueName !== this.queueName) return;

    if (change.type === "UPDATE" && change.new) {
      const newStatus = change.new.status;
      const oldStatus = change.old?.status;

      if (newStatus === JobStatus.PROCESSING && oldStatus === JobStatus.PENDING) {
        this.handleJobStart(jobId);
      } else if (newStatus === JobStatus.COMPLETED) {
        this.handleJobComplete(jobId, change.new.output as Output);
      } else if (newStatus === JobStatus.FAILED) {
        this.handleJobError(
          jobId,
          change.new.error ?? "Job failed",
          change.new.error_code ?? undefined
        );
      } else if (newStatus === JobStatus.DISABLED) {
        this.handleJobDisabled(jobId);
      } else if (newStatus === JobStatus.PENDING && oldStatus === JobStatus.PROCESSING) {
        // Retry
        const visibleAt = change.new.visible_at ? new Date(change.new.visible_at) : new Date();
        this.handleJobRetry(jobId, visibleAt);
      }

      // Progress update
      if (
        change.new.progress !== change.old?.progress ||
        change.new.progress_message !== change.old?.progress_message
      ) {
        this.handleJobProgress(
          jobId,
          change.new.progress ?? 0,
          change.new.progress_message ?? "",
          change.new.progress_details ?? null
        );
      }
    }
  }

  protected storageToClass(details: JobStorageFormat<Input, Output>): Job<Input, Output> {
    return storageToClass(details, Job);
  }

  protected buildErrorFromJob(job: Job<Input, Output>): JobError {
    return this.buildErrorFromCode(job.error || "Job failed", job.errorCode ?? undefined);
  }

  protected buildErrorFromCode(message: string, errorCode?: string): JobError {
    // Built-in codes take precedence over the {@link JobErrorRegistry} so a
    // registered prefix can never accidentally intercept core types
    // (e.g. a `"P"` prefix shadowing `PermanentJobError`). Only after the
    // built-in switch fails do we consult the registry for domain-specific
    // codes (e.g. FETCH_*, LLM_*, FILE_*). See `JobErrorRegistry.ts` for
    // the contract.
    if (errorCode === "PermanentJobError") {
      const err = new PermanentJobError(message);
      applyPersistedDiagnosticsToStack(err, message);
      return err;
    }
    if (errorCode === "RetryableJobError") {
      const err = new RetryableJobError(message);
      applyPersistedDiagnosticsToStack(err, message);
      return err;
    }
    if (errorCode === "AbortSignalJobError") {
      const err = new AbortSignalJobError(message);
      applyPersistedDiagnosticsToStack(err, message);
      return err;
    }
    if (errorCode === "JobDisabledError") {
      const err = new JobDisabledError(message);
      applyPersistedDiagnosticsToStack(err, message);
      return err;
    }
    if (errorCode) {
      const reconstructor = lookupErrorCodeReconstructor(errorCode);
      if (reconstructor) {
        try {
          const err = reconstructor(errorCode, message);
          // Reconstructors MUST set `code` per the registry contract, but
          // defend against forgetful implementations so downstream branching
          // on `err.code` still works. Mismatches are likely bugs in the
          // reconstructor — warn so they're visible.
          if (err.code !== errorCode) {
            if (err.code) {
              getLogger().warn("error-code reconstructor returned mismatched code; overriding", {
                errorCode,
                reconstructorCode: err.code,
              });
            }
            err.code = errorCode;
          }
          applyPersistedDiagnosticsToStack(err, message);
          return err;
        } catch (reconstructorError) {
          // A throwing reconstructor must not break job-result delivery —
          // fall through to the generic `JobError` path with `code`
          // preserved so callers can still branch on the persisted code.
          getLogger().warn("error-code reconstructor threw", {
            errorCode,
            error: reconstructorError,
          });
        }
      }
    }
    const err = new JobError(message);
    if (errorCode) {
      err.code = errorCode;
    }
    applyPersistedDiagnosticsToStack(err, message);
    return err;
  }
}
