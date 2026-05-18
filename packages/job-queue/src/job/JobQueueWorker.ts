/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EventEmitter,
  getLogger,
  getTelemetryProvider,
  sleep,
  SpanStatusCode,
  uuid4,
} from "@workglow/util";
import { ILimiter } from "../limiter/ILimiter";
import { NullLimiter } from "../limiter/NullLimiter";
import type { IClaim } from "../queue-storage/IClaim";
import type { IJobStore } from "../queue-storage/IJobStore";
import type { IMessageQueue } from "../queue-storage/IMessageQueue";
import type { IQueueStorage, JobStorageFormat } from "../queue-storage/IQueueStorage";
import { JobStatus } from "../queue-storage/IQueueStorage";
import { wrapQueueStorage } from "../queue-storage/wrapQueueStorage";
import type { DeadLetter } from "./DeadLetter";
import { Job, JobClass } from "./Job";
import {
  AbortSignalJobError,
  JobDisabledError,
  JobError,
  JobNotFoundError,
  PermanentJobError,
  RetryableJobError,
} from "./JobError";
import { withJobErrorDiagnostics } from "./JobErrorDiagnostics";
import { classToStorage, storageToClass } from "./JobStorageConverters";

/**
 * Upper bound on {@link JobQueueWorker.getLimiterWakeDelay}. Prevents a
 * misconfigured or stuck limiter (e.g. one whose `getNextAvailableTime`
 * returns hours in the future) from making the worker unresponsive — it
 * wakes at least this often regardless of what the limiter says.
 */
const MAX_LIMITER_WAKE_MS = 30_000;

/**
 * Events emitted by JobQueueWorker
 */
export type JobQueueWorkerEventListeners<Input, Output> = {
  job_start: (jobId: unknown) => void;
  job_complete: (jobId: unknown, output: Output) => void;
  job_error: (jobId: unknown, error: string, errorCode?: string) => void;
  job_disabled: (jobId: unknown) => void;
  job_retry: (jobId: unknown, visibleAt: Date) => void;
  job_progress: (
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, unknown> | null
  ) => void;
  worker_start: () => void;
  worker_stop: () => void;
};

export type JobQueueWorkerEvents = keyof JobQueueWorkerEventListeners<unknown, unknown>;

/**
 * Options for creating a JobQueueWorker
 */
export interface JobQueueWorkerOptions<Input, Output> {
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
  readonly pollIntervalMs?: number;
  /**
   * Optional worker ID. If not provided, a random UUID will be generated.
   * Use a persistent ID if you want the worker to reclaim its own jobs after restart.
   */
  readonly workerId?: string | null;
  /**
   * Max time `stop()` waits for in-flight jobs to finish before forcing aborts.
   * Defaults to 30s. Set to 0 to abort immediately.
   */
  readonly stopTimeoutMs?: number;
  /**
   * If true, the worker will call extendLease periodically while a job is
   * executing. Extension interval is leaseMs * 0.5. Default: false.
   */
  readonly extendLeaseWhileRunning?: boolean;
  /**
   * How long (ms) the worker's lease on a claimed job lasts before another
   * worker may re-claim it. Must be long enough to cover the maximum
   * expected job duration if extendLeaseWhileRunning is false.
   * Defaults to max(30_000, pollIntervalMs * 60).
   */
  readonly leaseMs?: number;
  /**
   * Dead-letter queue to forward exhausted jobs to, or "discard" to drop them.
   * Default: "discard".
   */
  readonly deadLetter?: IMessageQueue<DeadLetter<Input>> | "discard";
  /**
   * Number of claims to fetch per loop iteration. Default: 1.
   * With prefetch > 1, claims that cannot immediately acquire a limiter slot
   * are released back to PENDING via retry, so concurrency is still governed
   * by the limiter.
   */
  readonly prefetch?: number;
}

/**
 * Worker that processes jobs from the queue.
 * Reports progress and completion back to storage.
 */
export class JobQueueWorker<
  Input,
  Output,
  QueueJob extends Job<Input, Output> = Job<Input, Output>,
> {
  public readonly queueName: string;
  public readonly workerId: string;
  protected readonly messageQueue: IMessageQueue<JobStorageFormat<Input, Output>>;
  protected readonly jobStore: IJobStore<Input, Output>;
  protected readonly jobClass: JobClass<Input, Output>;
  protected readonly limiter: ILimiter;
  protected readonly pollIntervalMs: number;
  protected readonly stopTimeoutMs: number;
  protected readonly extendLeaseWhileRunning: boolean;
  protected readonly leaseMs: number;
  protected readonly events = new EventEmitter<JobQueueWorkerEventListeners<Input, Output>>();
  protected readonly deadLetter: IMessageQueue<DeadLetter<Input>> | "discard";
  protected readonly prefetch: number;

  protected running = false;

  /**
   * Tracks in-flight job executions for drain-on-stop.
   * Each entry's promise resolves (never rejects) when the job settles
   * (complete / fail / retry / abort).
   */
  private readonly inFlight: Map<unknown, Promise<void>> = new Map();

  /**
   * Active claims for jobs currently being processed. Used to drive
   * ack/retry/fail/extendLease in completion paths.
   */
  private readonly activeClaims: Map<unknown, IClaim<JobStorageFormat<Input, Output>>> = new Map();

  /**
   * Resolve function for the idle wait promise.
   * When set, the worker is idle and waiting for either a notification or poll timeout.
   */
  private wakeResolve: (() => void) | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Set when {@link notify} fires while the worker is not yet idle. The next
   * {@link waitForWakeOrTimeout} call consumes it and returns immediately
   * instead of sleeping. Without this flag, a notify that arrives during
   * `processJobs`'s pre-idle awaits (e.g. while `storage.next` and
   * `storage.peek` are in flight) would be dropped on the floor and the
   * worker would sleep for the full poll interval despite there being work
   * to do — observed under load on IndexedDb.
   */
  private wakePending = false;

  /**
   * Promise for the running `processJobs` loop. Captured in {@link start} so
   * {@link stop} can await actual loop exit instead of returning while the
   * loop is still suspended mid-iteration. Without this, a loop parked in
   * `await this.next()` could resume after stop returned and claim a job
   * that was submitted after stop — starting `processSingleJob` on a worker
   * that's no longer running.
   */
  private loopPromise: Promise<void> | null = null;

  /**
   * Abort controllers for active jobs
   */
  protected readonly activeJobAbortControllers: Map<unknown, AbortController> = new Map();

  /**
   * Processing times for statistics
   */
  protected readonly processingTimes: Map<unknown, number> = new Map();

  constructor(jobClass: JobClass<Input, Output>, options: JobQueueWorkerOptions<Input, Output>) {
    this.queueName = options.queueName;
    this.workerId = options.workerId ?? uuid4();
    if (options.messageQueue && options.jobStore) {
      this.messageQueue = options.messageQueue;
      this.jobStore = options.jobStore;
    } else if (options.storage) {
      const wrapped = wrapQueueStorage(options.storage);
      this.messageQueue = wrapped.messageQueue;
      this.jobStore = wrapped.jobStore;
    } else {
      throw new Error(
        "JobQueueWorker requires either `storage` or both `messageQueue` and `jobStore`"
      );
    }
    this.jobClass = jobClass;
    this.limiter = options.limiter ?? new NullLimiter();
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 30_000;
    this.extendLeaseWhileRunning = options.extendLeaseWhileRunning ?? false;
    this.leaseMs = options.leaseMs ?? Math.max(30_000, this.pollIntervalMs * 60);
    this.deadLetter = options.deadLetter ?? "discard";
    this.prefetch = Math.max(1, options.prefetch ?? 1);
  }

  /**
   * Start the worker processing loop
   */
  public async start(): Promise<this> {
    if (this.running) {
      return this;
    }
    this.running = true;
    this.events.emit("worker_start");
    this.loopPromise = this.processJobs();
    return this;
  }

  /**
   * If this worker is currently processing the given job, fire its abort controller
   * immediately and return true. Returns false if the job isn't active on this worker.
   * @internal
   */
  public requestAbort(jobId: unknown): boolean {
    const controller = this.activeJobAbortControllers.get(jobId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Wake the worker from idle sleep so it checks for jobs immediately.
   * If the worker is not yet idle, latches a pending-wake flag that the next
   * {@link waitForWakeOrTimeout} call consumes — so wake notifications that
   * race with worker startup or mid-iteration awaits are not lost.
   */
  public notify(): void {
    this.wakePending = true;
    if (this.wakeResolve) {
      if (this.wakeTimer) {
        clearTimeout(this.wakeTimer);
        this.wakeTimer = null;
      }
      const resolve = this.wakeResolve;
      this.wakeResolve = null;
      resolve();
    }
  }

  /**
   * Stop the worker, draining in-flight jobs up to {@link stopTimeoutMs}
   * before aborting anything still running.
   */
  public async stop(): Promise<this> {
    if (!this.running) {
      return this;
    }
    this.running = false;

    // Wake from idle sleep so the processing loop can exit.
    this.notify();

    // Wait for the processJobs loop to actually exit. Without this, a loop
    // suspended mid-iteration (e.g. inside `await this.next()`) could resume
    // after stop returned and claim/start a freshly-submitted job — leaving
    // a "stopped" worker running PROCESSING jobs.
    const loopPromise = this.loopPromise;
    this.loopPromise = null;
    if (loopPromise) {
      await loopPromise;
    }

    // Phase 1 — graceful drain.
    if (this.stopTimeoutMs > 0 && this.inFlight.size > 0) {
      const drain = Promise.allSettled([...this.inFlight.values()]);
      await Promise.race([drain, sleep(this.stopTimeoutMs)]);
    }

    // Phase 2 — anything still running gets aborted.
    if (this.inFlight.size > 0) {
      for (const controller of this.activeJobAbortControllers.values()) {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      }
      const abortDrain = Promise.allSettled([...this.inFlight.values()]);
      await Promise.race([abortDrain, sleep(1000)]);
    }

    this.events.emit("worker_stop");
    return this;
  }

  /**
   * Process a single job manually (useful for testing or manual control).
   *
   * Uses the atomic claim->acquire->release pattern: claim a job, then atomically
   * reserve a limiter slot. If the limiter rejects (e.g. raced another worker
   * to the last slot), the claimed job is released back to PENDING.
   */
  public async processNext(): Promise<boolean> {
    const job = await this.next();
    if (!job) {
      return false;
    }
    const limiterToken = await this.limiter.tryAcquire();
    if (limiterToken === null || limiterToken === undefined) {
      await this.releaseClaimedJob(job);
      return false;
    }
    await this.processSingleJob(job, limiterToken);
    return true;
  }

  /**
   * Check if the worker is currently running
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the number of active jobs being processed
   */
  public getActiveJobCount(): number {
    return this.activeJobAbortControllers.size;
  }

  /**
   * Get average processing time
   */
  public getAverageProcessingTime(): number | undefined {
    const times = Array.from(this.processingTimes.values());
    if (times.length === 0) return undefined;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  // ========================================================================
  // Event handling
  // ========================================================================

  public on<Event extends JobQueueWorkerEvents>(
    event: Event,
    listener: JobQueueWorkerEventListeners<Input, Output>[Event]
  ): void {
    this.events.on(event, listener);
  }

  public off<Event extends JobQueueWorkerEvents>(
    event: Event,
    listener: JobQueueWorkerEventListeners<Input, Output>[Event]
  ): void {
    this.events.off(event, listener);
  }

  // ========================================================================
  // Protected methods
  // ========================================================================

  /**
   * Get the next job from the queue (always fetches a single claim).
   * Used by {@link processNext} and the single-claim path of {@link processJobs}.
   */
  protected async next(): Promise<QueueJob | undefined> {
    const claims = await this.messageQueue.receive({
      workerId: this.workerId,
      leaseMs: this.leaseMs,
      max: 1,
    });
    const claim = claims[0];
    if (!claim) return undefined;
    const job = this.storageToClass(claim.body) as QueueJob;
    if (job.id != null) {
      this.activeClaims.set(job.id, claim);
    }
    return job;
  }

  /**
   * Fetch up to `this.prefetch` claims from the queue and register them in
   * {@link activeClaims}. Returns an array of jobs ready to be dispatched.
   */
  private async nextBatch(): Promise<QueueJob[]> {
    const claims = await this.messageQueue.receive({
      workerId: this.workerId,
      leaseMs: this.leaseMs,
      max: this.prefetch,
    });
    const jobs: QueueJob[] = [];
    for (const claim of claims) {
      const job = this.storageToClass(claim.body) as QueueJob;
      if (job.id != null) {
        this.activeClaims.set(job.id, claim);
      }
      jobs.push(job);
    }
    return jobs;
  }

  /**
   * Main job processing loop.
   *
   * Runs as a tight `while` loop (no recursive `setTimeout`) so that
   * back-to-back jobs are picked up with minimal inter-job latency.
   *
   * When no jobs are available the worker sleeps until either:
   * - {@link notify} is called (e.g. because the server saw a new job inserted
   *   or a running job completed and freed a concurrency slot), or
   * - the poll-interval timeout expires (fallback for storages without push
   *   events).
   */
  protected async processJobs(): Promise<void> {
    while (this.running) {
      try {
        // Check for aborting jobs
        await this.checkForAbortingJobs();

        // Claim first, then atomically reserve a limiter slot. Doing the claim
        // before the acquire avoids a race window: with the previous "check
        // canProceed -> claim -> recordJobStart" sequence, two workers could
        // both observe count < max, both claim, and both then increment —
        // overshooting the configured limit by exactly the worker concurrency.
        // The atomic tryAcquire guarantees only one of N concurrent acquirers
        // succeeds when there's one slot left.
        //
        // With prefetch > 1, we claim up to `prefetch` jobs at once and do a
        // non-blocking tryAcquire for each. Jobs that can't immediately get a
        // limiter slot are released back to PENDING so other workers can pick
        // them up. With prefetch == 1 the behavior is identical to before.
        const jobs = await this.nextBatch();
        if (jobs.length === 0) {
          // Queue is empty — sleep until notified of new work or until the
          // next deferred job becomes ready.
          const delay = await this.getIdleDelay();
          await this.waitForWakeOrTimeout(delay);
          continue;
        }

        let anyDispatched = false;
        let limiterFull = false;

        for (const job of jobs) {
          if (!this.running) {
            // Stopped during the batch. Release all remaining jobs back to PENDING.
            await this.releaseClaimedJob(job);
            continue;
          }

          const limiterToken = await this.limiter.tryAcquire();
          if (limiterToken === null || limiterToken === undefined) {
            // No limiter slot available — release the claim back so another
            // worker (or this one on a later iteration) can pick it up.
            await this.releaseClaimedJob(job);
            limiterFull = true;
            continue;
          }

          if (!this.running) {
            // Stop fired while tryAcquire was in flight.
            try {
              await this.limiter.release(limiterToken);
            } catch {
              // best-effort
            }
            await this.releaseClaimedJob(job);
            continue;
          }

          // Don't await - process in background to allow concurrent jobs.
          this.processSingleJob(job, limiterToken);
          anyDispatched = true;
        }

        if (!this.running) {
          return;
        }

        // If the limiter was full for every claim we fetched, back off before
        // retrying so we don't busy-loop hammering the queue.
        if (!anyDispatched && limiterFull) {
          await this.waitForWakeOrTimeout(await this.getLimiterWakeDelay());
        }
      } catch {
        // Don't let transient errors kill the loop
        await sleep(this.pollIntervalMs);
      }
    }
  }

  /**
   * How long to sleep when the limiter rejected an acquire. Reads the limiter's
   * own next-available time so we wake exactly when capacity opens, instead of
   * polling every {@link pollIntervalMs}. Clamped to {@link pollIntervalMs}
   * (lower bound) and {@link MAX_LIMITER_WAKE_MS} (upper bound) so a
   * misconfigured/stuck limiter still wakes occasionally.
   */
  private async getLimiterWakeDelay(): Promise<number> {
    try {
      const next = await this.limiter.getNextAvailableTime();
      const delay = next.getTime() - Date.now();
      if (delay <= 0) return this.pollIntervalMs;
      return Math.min(Math.max(delay, this.pollIntervalMs), MAX_LIMITER_WAKE_MS);
    } catch {
      return this.pollIntervalMs;
    }
  }

  /**
   * Determine how long to sleep when idle.
   *
   * Peeks at the earliest PENDING job: if it has a future `visible_at`,
   * returns the time until it becomes ready (clamped to `pollIntervalMs`);
   * otherwise returns `pollIntervalMs`.
   */
  private async getIdleDelay(): Promise<number> {
    try {
      const pending = await this.jobStore.peek(JobStatus.PENDING, 1);
      if (pending.length > 0 && pending[0].visible_at) {
        const delay = new Date(pending[0].visible_at).getTime() - Date.now();
        if (delay > 0) {
          return Math.min(delay, this.pollIntervalMs);
        }
      }
    } catch {
      // If peek fails, fall back to default
    }
    return this.pollIntervalMs;
  }

  /**
   * Wait for either a {@link notify} call or the given timeout,
   * whichever comes first. Consumes any pending wake latched while the worker
   * was not yet idle (see {@link wakePending}) — returns immediately in that
   * case rather than sleeping.
   */
  private waitForWakeOrTimeout(timeoutMs: number): Promise<void> {
    if (this.wakePending) {
      this.wakePending = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.wakeTimer = setTimeout(() => {
        this.wakeTimer = null;
        this.wakeResolve = null;
        this.wakePending = false;
        resolve();
      }, timeoutMs);

      this.wakeResolve = () => {
        this.wakePending = false;
        resolve();
      };
    });
  }

  /**
   * Check for in-process jobs that have abort_requested_at set and trigger
   * their abort controllers. Only relevant for jobs running on THIS worker
   * (we have an abort controller registered for them). When no jobs are active,
   * the peek result is irrelevant — skip the storage round-trip entirely.
   * Important for battery life on same-process deployments (browser/mobile)
   * where workers spend most time idle.
   */
  protected async checkForAbortingJobs(): Promise<void> {
    if (this.activeJobAbortControllers.size === 0) {
      return;
    }
    const processingJobs = await this.jobStore.peek(JobStatus.PROCESSING);
    for (const jobData of processingJobs) {
      if (!jobData.abort_requested_at) continue;
      const controller = this.activeJobAbortControllers.get(jobData.id);
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  /**
   * Process a single job
   */
  protected async processSingleJob(job: Job<Input, Output>, limiterToken: unknown): Promise<void> {
    if (!job || !job.id) {
      throw new JobNotFoundError("Invalid job provided for processing");
    }

    const { promise: inFlightPromise, resolve: resolveInFlight } = Promise.withResolvers<void>();
    this.inFlight.set(job.id, inFlightPromise);

    const startTime = Date.now();

    // Start telemetry span for job processing
    const telemetry = getTelemetryProvider();
    const span = telemetry.isEnabled
      ? telemetry.startSpan("workglow.job.process", {
          attributes: {
            "workglow.job.id": String(job.id),
            "workglow.job.queue": this.queueName,
            "workglow.job.lease_owner": this.workerId,
            "workglow.job.attempt": job.attempts,
            "workglow.job.max_attempts": job.maxAttempts,
          },
        })
      : undefined;

    // Flag to skip complete() in finally when release() was already called.
    let limiterReleased = false;
    try {
      // The limiter slot was already atomically reserved by tryAcquire() in
      // the main loop (or processNext), so we no longer call recordJobStart
      // here — doing so would double-count.
      try {
        await this.validateJobState(job);
      } catch (validationErr) {
        // Validation failed before execution started — undo the reservation as
        // if the job never ran. release() is correct here (not complete()): for
        // RateLimiter, complete() is a no-op and the window slot would be
        // permanently consumed even though no work was done.
        await this.limiter.release(limiterToken);
        limiterReleased = true;
        throw validationErr;
      }

      const abortController = this.createAbortController(job.id);
      this.events.emit("job_start", job.id);

      let leaseInterval: ReturnType<typeof setInterval> | undefined;
      if (this.extendLeaseWhileRunning) {
        leaseInterval = setInterval(() => {
          const claim = this.activeClaims.get(job.id);
          if (!claim) return;
          claim.extendLease(this.leaseMs).catch((err) => {
            getLogger().error("extendLease failed during job execution:", {
              error: err,
              jobId: job.id,
            });
          });
        }, this.leaseMs * 0.5);
      }

      let output: Output;
      try {
        output = await this.executeJob(job, abortController.signal);
      } finally {
        if (leaseInterval !== undefined) {
          clearInterval(leaseInterval);
        }
      }
      await this.completeJob(job, output);

      const elapsed = Date.now() - startTime;
      this.processingTimes.set(job.id, elapsed);

      if (span) {
        span.setAttributes({ "workglow.job.duration_ms": elapsed });
        span.setStatus(SpanStatusCode.OK);
      }
    } catch (err: unknown) {
      const error = this.normalizeError(err);
      let spanErrorMessage = error.message;
      if (error instanceof RetryableJobError) {
        const currentJob = await this.getJob(job.id);
        if (!currentJob) {
          throw new JobNotFoundError(`Job ${job.id} not found`);
        }

        if (currentJob.attempts + 1 >= currentJob.maxAttempts) {
          spanErrorMessage = "Max attempts reached";
          // Forward to dead-letter queue before marking as failed
          if (this.deadLetter !== "discard") {
            try {
              await this.deadLetter.send({
                original: currentJob.input,
                error: error.message,
                errorCode: error.constructor.name ?? null,
                attempts: currentJob.attempts,
                queueName: this.queueName,
                jobRunId: currentJob.jobRunId,
              });
            } catch (dlqErr) {
              getLogger().error("Dead-letter queue send failed:", { error: dlqErr });
            }
          }
          await this.failJob(currentJob, new PermanentJobError(spanErrorMessage));
          span?.setStatus(SpanStatusCode.ERROR, spanErrorMessage);
        } else {
          // Only delete the abort controller (not the claim) so rescheduleJob
          // can still call claim.retry(). rescheduleJob's finally block drops
          // the claim from activeClaims after it has been settled.
          this.activeJobAbortControllers.delete(job.id);
          await this.rescheduleJob(currentJob, error.retryDate);
          span?.addEvent("workglow.job.retry", {
            "workglow.job.attempt": currentJob.attempts,
          });
          span?.setStatus(SpanStatusCode.UNSET);
        }
      } else {
        await this.failJob(job, error);
        span?.setStatus(SpanStatusCode.ERROR, error.message);
      }
      span?.setAttributes({ "workglow.job.error": spanErrorMessage });
    } finally {
      if (!limiterReleased) {
        await this.limiter.complete(limiterToken);
      }
      span?.end();
      // Guard against a concurrent processSingleJob for the same jobId (which
      // can start before this finally block runs, e.g. after a reschedule).
      // Only delete our own inFlight entry; if another invocation already
      // replaced it, leave that entry alone.
      if (this.inFlight.get(job.id) === inFlightPromise) {
        this.inFlight.delete(job.id);
      }
      resolveInFlight();
    }
  }

  /**
   * Execute a job with the provided abort signal
   */
  protected async executeJob(job: Job<Input, Output>, signal: AbortSignal): Promise<Output> {
    if (!job) throw new JobNotFoundError("Cannot execute null or undefined job");
    return await job.execute(job.input, {
      signal,
      updateProgress: this.updateProgress.bind(this, job.id),
    });
  }

  /**
   * Update progress for a job.
   *
   * Mid-job progress is delivered in-memory via the `job_progress` event;
   * storage is only touched at terminal transitions (complete / fail / retry).
   * Cross-process observers therefore see state transitions but not fine-grained
   * progress — subscribe to an attached `JobQueueClient` for that.
   */
  protected async updateProgress(
    jobId: unknown,
    progress: number,
    message: string = "",
    details: Record<string, unknown> | null = null
  ): Promise<void> {
    progress = Math.max(0, Math.min(100, progress));
    this.events.emit("job_progress", jobId, progress, message, details);
  }

  /** Internal — resolve the active claim for a job id, throw if missing. */
  private getClaim(jobId: unknown): IClaim<JobStorageFormat<Input, Output>> | undefined {
    return this.activeClaims.get(jobId);
  }

  /**
   * Mark a job as completed
   */
  protected async completeJob(job: Job<Input, Output>, output?: Output): Promise<void> {
    try {
      job.status = JobStatus.COMPLETED;
      job.progress = 100;
      job.progressMessage = "";
      job.progressDetails = null;
      job.completedAt = new Date();
      job.output = output ?? null;
      job.error = null;
      job.errorCode = null;

      const claim = this.getClaim(job.id);
      await this.jobStore.saveResult(job.id, (output ?? null) as Output);
      if (claim) {
        await claim.ack();
      }
      this.events.emit("job_complete", job.id, output as Output);
    } catch (err) {
      getLogger().error("completeJob errored:", { error: err });
    } finally {
      this.cleanupJob(job.id);
    }
  }

  /**
   * Mark a job as failed
   */
  protected async failJob(job: Job<Input, Output>, error: JobError): Promise<void> {
    try {
      job.status = JobStatus.FAILED;
      job.progress = 100;
      job.completedAt = new Date();
      job.progressMessage = "";
      job.progressDetails = null;
      job.error = error.message;
      job.errorCode = error?.constructor?.name ?? null;

      const claim = this.getClaim(job.id);
      await this.jobStore.saveError(job.id, error.message, error.constructor.name ?? null, false);
      if (claim) {
        await claim.fail();
      }
      this.events.emit("job_error", job.id, error.message, error.constructor.name);
    } catch (err) {
      getLogger().error("failJob errored:", { error: err });
    } finally {
      this.cleanupJob(job.id);
    }
  }

  /**
   * Mark a job as disabled
   */
  protected async disableJob(job: Job<Input, Output>): Promise<void> {
    try {
      job.status = JobStatus.DISABLED;
      job.progress = 100;
      job.completedAt = new Date();
      job.progressMessage = "";
      job.progressDetails = null;

      // IClaim has no "disable" terminal. Release the lease via fail() (writes
      // FAILED), then immediately overwrite status to DISABLED via saveStatus()
      // so storage reflects the correct terminal state.
      const claim = this.getClaim(job.id);
      if (claim) {
        await claim.fail();
      }
      await this.jobStore.saveStatus(job.id, JobStatus.DISABLED);
      this.events.emit("job_disabled", job.id);
    } catch (err) {
      getLogger().error("disableJob errored:", { error: err });
    } finally {
      this.cleanupJob(job.id);
    }
  }

  /**
   * Release a job that {@link next} just claimed but that we won't process
   * because the worker was stopped mid-claim. Resets the row to PENDING so
   * the next started worker can pick it up. Lease expiry in `next()` would
   * otherwise reclaim it after the lease expires.
   *
   * Uses `storage.releaseClaim()` rather than `storage.complete()` so the retry
   * budget isn't burned: the worker never actually attempted execution.
   */
  protected async releaseClaimedJob(job: Job<Input, Output>): Promise<void> {
    try {
      // Prefer driving the claim's release path so any per-claim cleanup
      // (e.g. transient buffers) is consistent with regular settlement.
      const claim = this.activeClaims.get(job.id);
      if (claim) {
        await this.messageQueue.releaseClaim(claim.id);
      } else {
        // Fallback when the claim was never registered (e.g. worker stopped
        // between receive() and activeClaims.set). Passes the job id, not a
        // receipt handle — adapters whose claim.id differs from job.id (e.g.
        // SQS) should treat this as best-effort and no-op if no live handle
        // is available.
        await this.messageQueue.releaseClaim(job.id);
      }
    } catch (err) {
      getLogger().error("releaseClaimedJob errored:", { error: err });
    } finally {
      this.activeClaims.delete(job.id);
    }
  }

  /**
   * Reschedule a job for retry
   */
  protected async rescheduleJob(job: Job<Input, Output>, retryDate?: Date): Promise<void> {
    try {
      job.status = JobStatus.PENDING;
      const nextAvailableTime = await this.limiter.getNextAvailableTime();
      job.visibleAt = retryDate instanceof Date ? retryDate : nextAvailableTime;
      job.progress = 0;
      job.progressMessage = "";
      job.progressDetails = null;
      // Increment attempts to keep in-memory object in sync with storage
      // The storage layer will read from DB and increment, so this keeps them aligned
      job.attempts = (job.attempts ?? 0) + 1;

      const claim = this.getClaim(job.id);
      const delaySeconds = Math.max(0, (job.visibleAt.getTime() - Date.now()) / 1000);
      if (claim) {
        await claim.retry({ delaySeconds });
      }
      this.events.emit("job_retry", job.id, job.visibleAt);
    } catch (err) {
      getLogger().error("rescheduleJob errored:", { error: err });
    } finally {
      // rescheduleJob is called from the catch branch in processSingleJob,
      // which already calls cleanupJob via this method's path; ensure the
      // claim ref is dropped too.
      this.activeClaims.delete(job.id);
    }
  }

  /**
   * Create an abort controller for a job.
   *
   * The job MUST already be registered in {@link inFlight} — this enforces
   * the invariant that `activeJobAbortControllers ⊆ inFlight`, which
   * {@link handleAbort} relies on to decide whether `processSingleJob` is
   * still on the hook for the terminal write. Calling this from any path
   * other than `processSingleJob` (which registers `inFlight` first) is a
   * programming error.
   */
  protected createAbortController(jobId: unknown): AbortController {
    if (!jobId) throw new JobNotFoundError("Cannot create abort controller for undefined job");

    if (!this.inFlight.has(jobId)) {
      throw new Error(
        `createAbortController invariant violated: jobId ${String(jobId)} is not in inFlight. ` +
          `Abort controllers must only be created from within processSingleJob.`
      );
    }

    if (this.activeJobAbortControllers.has(jobId)) {
      return this.activeJobAbortControllers.get(jobId)!;
    }

    const abortController = new AbortController();
    abortController.signal.addEventListener("abort", () => this.handleAbort(jobId));
    this.activeJobAbortControllers.set(jobId, abortController);
    return abortController;
  }

  /**
   * Handle job abort.
   *
   * Two callers fire the controller and reach this listener:
   *   1. `requestAbort` — same-process abort while the job is in flight here.
   *   2. `checkForAbortingJobs` — cross-process abort observed via storage poll.
   *
   * In both cases, if processSingleJob is still running this job locally,
   * the abort signal will propagate into the user task and processSingleJob's
   * own catch path will write the terminal state. We must not race it: doing
   * so duplicates the `job_error` emit and, worse, can clobber a successful
   * `completeJob` that won the race (the COMPLETED→FAILED overwrite bug).
   *
   * If the job is no longer in flight here, it has already settled — recheck
   * storage and only write FAILED for non-terminal states (i.e. a PROCESSING
   * row left over from a cross-process abort that this worker never picked up).
   */
  protected async handleAbort(jobId: unknown): Promise<void> {
    if (this.inFlight.has(jobId)) {
      return;
    }
    const job = await this.getJob(jobId);
    if (!job) {
      getLogger().error("handleAbort: job not found", { jobId });
      return;
    }
    if (
      job.status === JobStatus.COMPLETED ||
      job.status === JobStatus.FAILED ||
      job.status === JobStatus.DISABLED
    ) {
      return;
    }
    await this.failJob(job, new AbortSignalJobError("Job Aborted"));
  }

  /**
   * Get a job by ID
   */
  protected async getJob(id: unknown): Promise<Job<Input, Output> | undefined> {
    const job = await this.jobStore.get(id);
    if (!job) return undefined;
    return this.storageToClass(job);
  }

  /**
   * Validate job state before processing
   */
  protected async validateJobState(job: Job<Input, Output>): Promise<void> {
    if (job.status === JobStatus.COMPLETED) {
      throw new PermanentJobError(`Job ${job.id} is already completed`);
    }
    if (job.status === JobStatus.FAILED) {
      throw new PermanentJobError(`Job ${job.id} has failed`);
    }
    if (this.activeJobAbortControllers.get(job.id)?.signal.aborted) {
      throw new AbortSignalJobError(`Job ${job.id} is being aborted`);
    }
    if (job.deadlineAt && job.deadlineAt < new Date()) {
      throw new PermanentJobError(`Job ${job.id} has exceeded its deadline`);
    }
    if (job.status === JobStatus.DISABLED) {
      throw new JobDisabledError(`Job ${job.id} has been disabled`);
    }
  }

  /**
   * Normalize errors into JobError instances
   */
  protected normalizeError(err: unknown): JobError {
    if (err instanceof JobError) {
      return err;
    }
    if (err instanceof Error) {
      return new PermanentJobError(withJobErrorDiagnostics(err.message, err));
    }
    return new PermanentJobError(String(err));
  }

  /**
   * Clean up job state after completion/failure
   */
  protected cleanupJob(jobId: unknown): void {
    this.activeJobAbortControllers.delete(jobId);
    this.activeClaims.delete(jobId);
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
