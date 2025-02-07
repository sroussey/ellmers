//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { ILimiter } from "./ILimiter";
import { Job, JobStatus } from "./Job";
import { sleep } from "../../util/Misc";

export abstract class JobError extends Error {
  public abstract retryable: boolean;
}

/**
 * A job error that is retryable
 *
 * Examples: network timeouts, temporary unavailability of an external service, or rate-limiting
 */
export class RetryableJobError extends JobError {
  constructor(
    message: string,
    public retryDate: Date
  ) {
    super(message);
    this.name = "RetryableJobError";
  }
  public retryable = true;
}

/**
 * A job error that is not retryable
 *
 * Examples: invalid input, missing required parameters, or a permanent failure of
 * an external service, permission errors, running out of money for an API, etc.
 */
export class PermanentJobError extends JobError {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
  public retryable = false;
}

/**
 *
 */
export class AbortSignalJobError extends PermanentJobError {
  constructor(message: string) {
    super(message);
    this.name = "AbortSignalJobError";
  }
}

/**
 * Events that can be emitted by the JobQueue
 */
export interface JobQueueEvents<Input, Output> {
  queue_start: [queueName: string];
  queue_stop: [queueName: string];
  job_start: [queueName: string, jobId: unknown];
  job_aborting: [queueName: string, jobId: unknown];
  job_complete: [queueName: string, jobId: unknown, output: Output];
  job_error: [queueName: string, jobId: unknown, error: string];
  job_retry: [queueName: string, jobId: unknown, retryDate: Date];
  queue_stats_update: [queueName: string, stats: JobQueueStats];
}

/**
 * Statistics tracked for the job queue
 */
export interface JobQueueStats {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  abortedJobs: number;
  retriedJobs: number;
  averageProcessingTime?: number;
  lastUpdateTime: Date;
}

/**
 * Base class for implementing job queues with different storage backends.
 * Provides core functionality for job management, execution, and monitoring.
 */
export abstract class JobQueue<Input, Output> {
  protected running: boolean = false;
  protected stats: JobQueueStats;
  protected events: EventEmitter<JobQueueEvents<Input, Output>>;
  protected activeJobSignals: Map<unknown, AbortController>;
  protected activeJobPromises: Map<
    unknown,
    Array<{ resolve: (out: Output) => void; reject: (err: JobError) => void }>
  >;
  protected processingTimes: Map<unknown, number>;

  constructor(
    public readonly queue: string,
    protected limiter: ILimiter,
    protected jobClass: typeof Job<Input, Output> = Job<Input, Output>,
    protected waitDurationInMilliseconds: number
  ) {
    this.events = new EventEmitter();
    this.activeJobSignals = new Map();
    this.activeJobPromises = new Map();
    this.processingTimes = new Map();
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      abortedJobs: 0,
      retriedJobs: 0,
      lastUpdateTime: new Date(),
    };
  }

  // Required abstract methods that must be implemented by storage-specific queues
  public abstract add(job: Job<Input, Output>): Promise<unknown>;
  public abstract get(id: unknown): Promise<Job<Input, Output> | undefined>;
  public abstract next(): Promise<Job<Input, Output> | undefined>;
  public abstract peek(num: number): Promise<Array<Job<Input, Output>>>;
  public abstract processing(): Promise<Array<Job<Input, Output>>>;
  public abstract aborting(): Promise<Array<Job<Input, Output>>>;
  public abstract size(status?: JobStatus): Promise<number>;
  public abstract complete(id: unknown, output?: Output, error?: JobError): Promise<void>;
  protected abstract deleteAll(): Promise<void>;
  public abstract outputForInput(taskType: string, input: Input): Promise<Output | null>;
  public abstract abort(jobId: unknown): Promise<void>;
  public abstract getJobsByRunId(jobRunId: string): Promise<Array<Job<Input, Output>>>;

  /**
   * Aborts all jobs in a job run
   */
  public async abortJobRun(jobRunId: string): Promise<void> {
    const jobs = await this.getJobsByRunId(jobRunId);
    await Promise.allSettled(
      jobs.map((job) => {
        if ([JobStatus.PROCESSING, JobStatus.PENDING].includes(job.status)) {
          this.abort(job.id);
        }
      })
    );
  }

  /**
   * Executes a job with the provided abort signal.
   * Can be overridden by implementations to add custom execution logic.
   */
  public async executeJob(job: Job<Input, Output>, signal?: AbortSignal): Promise<Output> {
    if (!job) throw new Error("Cannot execute null or undefined job");
    return await job.execute(signal);
  }

  /**
   * Registers an event listener for job queue events
   */
  public on<K extends keyof JobQueueEvents<Input, Output>>(
    event: K,
    listener: (...args: JobQueueEvents<Input, Output>[K]) => void
  ): void {
    this.events.on(event, listener);
  }

  /**
   * Removes an event listener for job queue events
   */
  public off<K extends keyof JobQueueEvents<Input, Output>>(
    event: K,
    listener?: (...args: JobQueueEvents<Input, Output>[K]) => void
  ): void {
    this.events.off(event, listener);
  }
  /**
   * Aborts a running job (if supported).
   * This method will signal the corresponding AbortController so that
   * the job's execute() method (if it supports an AbortSignal parameter)
   * can clean up and exit.
   */
  protected abortJob(jobId: unknown): void {
    const controller = this.activeJobSignals.get(jobId);
    if (controller) {
      controller.abort();
      this.events.emit("job_aborting", this.queue, jobId);
    } else {
      console.error(`Job ${jobId} not found in activeJobSignals`);
    }
  }

  /**
   * Creates an abort controller for a job and adds it to the activeJobSignals map
   */
  protected createAbortController(jobId: unknown): AbortController {
    if (!jobId) throw new Error("Cannot create abort controller for undefined job");
    if (this.activeJobSignals.has(jobId)) {
      throw new Error(`Abort controller for job ${jobId} already exists`);
    }
    const abortController = new AbortController();
    this.activeJobSignals.set(jobId, abortController);
    return abortController;
  }

  /**
   * Processes a job and handles its lifecycle including retries and error handling
   */
  protected async processJob(job: Job<Input, Output>): Promise<void> {
    if (!job || !job.id) throw new Error("Invalid job provided for processing");

    const startTime = Date.now();

    try {
      await this.validateJobState(job);
      await this.limiter.recordJobStart();
      this.emitStatsUpdate();

      const abortController = this.activeJobSignals.get(job.id);
      if (!abortController) {
        throw new Error(`Abort controller for job ${job.id} not found`);
      }
      this.events.emit("job_start", this.queue, job.id);
      const output = await this.executeJob(job, abortController.signal);
      await this.complete(job.id, output);

      this.processingTimes.set(job.id, Date.now() - startTime);
      this.updateAverageProcessingTime();
    } catch (err: any) {
      const error = this.normalizeError(err);

      if (error instanceof AbortSignalJobError) {
        this.events.emit("job_aborting", this.queue, job.id);
        this.stats.abortedJobs++;
      } else if (error instanceof RetryableJobError) {
        this.events.emit("job_retry", this.queue, job.id, error.retryDate);
        this.stats.retriedJobs++;
      } else {
        this.events.emit("job_error", this.queue, job.id, error.message);
        this.stats.failedJobs++;
      }

      await this.complete(job.id, undefined, error);
    } finally {
      await this.limiter.recordJobCompletion();
      this.activeJobSignals.delete(job.id);
      this.emitStatsUpdate();
    }
  }

  /**
   * Validates the state of a job before processing
   */
  protected async validateJobState(job: Job<Input, Output>): Promise<void> {
    if (job.status === JobStatus.COMPLETED) {
      throw new Error(`Job ${job.id} is already completed`);
    }
    if (job.status === JobStatus.FAILED) {
      throw new Error(`Job ${job.id} has failed`);
    }
    if (job.status === JobStatus.ABORTING) {
      throw new Error(`Job ${job.id} is being aborted`);
    }
    if (job.deadlineAt && job.deadlineAt < new Date()) {
      throw new Error(`Job ${job.id} has exceeded its deadline`);
    }
  }

  /**
   * Normalizes different types of errors into JobError instances
   */
  protected normalizeError(err: any): JobError {
    if (err instanceof JobError) {
      return err;
    }
    if (err instanceof Error) {
      return new PermanentJobError(err.message);
    }
    return new PermanentJobError(String(err));
  }

  /**
   * Updates average processing time statistics
   */
  protected updateAverageProcessingTime(): void {
    const times = Array.from(this.processingTimes.values());
    if (times.length > 0) {
      this.stats.averageProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;
    }
  }

  /**
   * Emits updated statistics
   */
  protected emitStatsUpdate(): void {
    this.stats.lastUpdateTime = new Date();
    this.events.emit("queue_stats_update", this.queue, { ...this.stats });
  }

  /**
   * Handles job completion and promise resolution
   */
  protected onCompleted(
    jobId: unknown,
    status: JobStatus,
    output: Output | null = null,
    error?: JobError
  ): void {
    const promises = this.activeJobPromises.get(jobId) || [];

    if (status === JobStatus.FAILED) {
      this.events.emit("job_error", this.queue, jobId, `${error!.name}: ${error!.message}`);
      this.stats.failedJobs++;
      promises.forEach(({ reject }) => reject(error!));
    } else if (status === JobStatus.COMPLETED) {
      this.events.emit("job_complete", this.queue, jobId, output!);
      this.stats.completedJobs++;
      promises.forEach(({ resolve }) => resolve(output!));
    }

    this.activeJobPromises.delete(jobId);
    this.emitStatsUpdate();
  }

  /**
   * Returns a promise that resolves when the job completes
   */
  public waitFor(jobId: unknown): Promise<Output> {
    return new Promise((resolve, reject) => {
      const promises = this.activeJobPromises.get(jobId) || [];
      promises.push({ resolve, reject });
      this.activeJobPromises.set(jobId, promises);
    });
  }

  /**
   * Creates a new job instance from the provided database results.
   * @param results - The job data from the database
   * @returns A new Job instance with populated properties
   */
  public createNewJob(results: any, parseIO = true): Job<Input, Output> {
    return new this.jobClass({
      ...results,
      input: (parseIO ? JSON.parse(results.input) : results.input) as Input,
      output: results.output
        ? ((parseIO ? JSON.parse(results.output) : results.output) as Output)
        : null,
      runAfter: results.runAfter ? new Date(results.runAfter + "Z") : null,
      createdAt: results.createdAt ? new Date(results.createdAt + "Z") : null,
      deadlineAt: results.deadlineAt ? new Date(results.deadlineAt + "Z") : null,
      lastRanAt: results.lastRanAt ? new Date(results.lastRanAt + "Z") : null,
    });
  }

  /**
   * Main job processing loop
   */
  private async processJobs(): Promise<void> {
    if (!this.running) {
      return;
    }
    try {
      const canProceed = await this.limiter.canProceed();
      if (canProceed) {
        const job = await this.next();
        if (job) {
          this.processJob(job);
        }
      }
      setTimeout(() => this.processJobs(), this.waitDurationInMilliseconds);
    } catch (error) {
      console.error(`Error in processJobs: ${error}`);
      setTimeout(() => this.processJobs(), this.waitDurationInMilliseconds);
    }
  }

  /**
   * Starts the job queue
   */
  public async start(): Promise<this> {
    if (this.running) {
      return this;
    }

    this.running = true;
    this.events.emit("queue_start", this.queue);
    this.processJobs();
    return this;
  }

  /**
   * Stops the job queue and aborts all active jobs
   */
  public async stop(): Promise<this> {
    if (this.running === false) return this;
    this.running = false;

    // Wait for pending operations to settle
    const size = await this.size(JobStatus.PROCESSING);
    const sleepTime = Math.max(100, size * 2);
    await sleep(sleepTime);

    // Abort all active jobs
    for (const [jobId] of this.activeJobSignals.entries()) {
      this.abortJob(jobId);
    }

    // Reject all waiting promises
    this.activeJobPromises.forEach((promises) =>
      promises.forEach(({ reject }) => reject(new PermanentJobError("Queue Stopped")))
    );

    // Wait for abort operations to settle
    await sleep(sleepTime);

    this.events.emit("queue_stop", this.queue);
    return this;
  }

  /**
   * Clears all jobs and resets queue state
   */
  public async clear(): Promise<this> {
    await this.deleteAll();
    this.activeJobSignals.clear();
    this.activeJobPromises.clear();
    this.processingTimes.clear();
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      abortedJobs: 0,
      retriedJobs: 0,
      lastUpdateTime: new Date(),
    };
    this.emitStatsUpdate();
    return this;
  }

  /**
   * Restarts the job queue
   */
  public async restart(): Promise<this> {
    await this.stop();
    await this.clear();
    return this.start();
  }

  /**
   * Returns current queue statistics
   */
  public getStats(): JobQueueStats {
    return { ...this.stats };
  }
}
