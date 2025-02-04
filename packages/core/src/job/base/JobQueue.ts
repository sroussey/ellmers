//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { ILimiter } from "./ILimiter";
import { Job, JobStatus } from "./Job";

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
    this.name = "JobTransientError";
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
    this.name = "JobPermanentError";
  }
  public retryable = false;
}

/**
 * Events that can be emitted by the JobQueue
 *
 * @event queue_start - Emitted when the queue starts
 * @event queue_stop - Emitted when the queue stops
 * @event job_start - Emitted when a job starts
 * @event job_aborting - Emitted when a job is aborting
 * @event job_complete - Emitted when a job is complete (after start and retries)
 * @event job_error - Emitted when a job errors (after aborting)
 * @event job_retry - Emitted when a job is retried
 */
type JobEvents =
  | "queue_start"
  | "queue_stop"
  | "job_start"
  | "job_aborting"
  | "job_complete"
  | "job_error"
  | "job_retry";

export abstract class JobQueue<Input, Output> {
  constructor(
    public readonly queue: string,
    protected limiter: ILimiter,
    protected waitDurationInMilliseconds: number
  ) {}

  // Public methods that must be implemented by the queue
  public abstract add(job: Job<Input, Output>): Promise<unknown>;
  public abstract get(id: unknown): Promise<Job<Input, Output> | undefined>;
  public abstract next(): Promise<Job<Input, Output> | undefined>;
  public abstract peek(num: number): Promise<Array<Job<Input, Output>>>;
  public abstract processing(): Promise<Array<Job<Input, Output>>>;
  public abstract aborting(): Promise<Array<Job<Input, Output>>>;
  public abstract size(status?: JobStatus): Promise<number>;
  public abstract complete(id: unknown, output?: Output | null, error?: JobError): Promise<void>;
  public abstract clear(): Promise<void>;
  public abstract outputForInput(taskType: string, input: Input): Promise<Output | null>;
  public abstract abort(jobId: unknown): Promise<void>;

  // Optional methods that can be overridden by the queue
  public async executeJob(job: Job<Input, Output>, signal?: AbortSignal): Promise<Output> {
    return await job.execute(signal);
  }

  // Private methods

  // Events

  private events = new EventEmitter<JobEvents>();
  public on(event: JobEvents, listener: (...args: any[]) => void) {
    return this.events.on(event, listener);
  }
  public off(event: JobEvents, listener?: (...args: any[]) => void) {
    return this.events.off(event, listener);
  }

  private activeJobSignals = new Map<unknown, AbortController>();
  private activeJobPromises = new Map<
    unknown,
    { resolve: (out: Output) => void; reject: (err: JobError) => void }
  >();
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
    }
  }

  protected async processJob(job: Job<Input, Output>) {
    console.error(`Processing job: ${job.id}`);
    const abortController = new AbortController();
    // Store the controller so that it can abort this job if needed.
    this.activeJobSignals.set(job.id, abortController);

    try {
      await this.limiter.recordJobStart();
      this.events.emit("job_start", this.queue, job.id);
      const output = await this.executeJob(job, abortController.signal);
      await this.complete(job.id, output);
    } catch (err: any) {
      console.error(`Error processing job: ${err}`);

      // If the error is an abort signal, optionally handle it here.
      if (err.name === "AbortError") {
        // The job was aborted. You might wish to differentiate this case.
        this.events.emit("job_aborting", this.queue, job.id);
      } else if (err instanceof RetryableJobError) {
        this.events.emit("job_retry", this.queue, job.id, err.retryDate);
      } else if (err instanceof PermanentJobError) {
        // Emit an error event for permanent errors
        this.events.emit("job_error", this.queue, job.id, err.message);
      } else {
        // For any generic error, treat it as permanent by wrapping it in a PermanentJobError
        err = new PermanentJobError(err.message || String(err));
        this.events.emit("job_error", this.queue, job.id, err.message);
      }
      await this.complete(job.id, null, err);
    } finally {
      await this.limiter.recordJobCompletion();
      this.activeJobSignals.delete(job.id);
    }
  }

  /**
   * Called when a job is completed (after retries)
   *
   * This method resolves or rejects the promise associated with the job.
   * It also emits the appropriate events based on the job's status.
   */
  protected onCompleted(jobId: unknown, status: JobStatus, output?: Output, error?: JobError) {
    // Find the job by jobId and resolve its promise if it exists
    const job = this.activeJobPromises.get(jobId);
    if (job) {
      if (status === JobStatus.FAILED) {
        this.events.emit("job_error", this.queue, jobId, `${error!.name}: ${error!.message}`);
        job.reject(error!);
      } else if (status === JobStatus.COMPLETED) {
        this.events.emit("job_complete", this.queue, jobId, output);
        job.resolve(output!);
      }
      // Remove the job from the map after completion
      this.activeJobPromises.delete(jobId);
    }
  }

  public waitFor(jobId: unknown): Promise<Output> {
    // Return a new promise for the job
    return new Promise((resolve, reject) => {
      // Store the resolve and reject functions in the map using jobId as the key
      // This allows us to resolve or reject the promise later when onCompleted is called
      this.activeJobPromises.set(jobId, { resolve, reject });
    });
  }

  private running = false;
  private async processJobs() {
    if (!this.running) return; // Stop processing if the queue has been stopped

    try {
      const canProceed = await this.limiter.canProceed();
      if (canProceed) {
        const job = await this.next();
        if (job) {
          this.processJob(job).catch((error) => console.error(`Error processing job: ${error}`));
        }
      }
      setTimeout(() => this.processJobs(), this.waitDurationInMilliseconds);
    } catch (error) {
      console.error(`Error in processJobs: ${error}`);
      setTimeout(() => this.processJobs(), this.waitDurationInMilliseconds);
    }
  }

  /**
   * Starts the queue and processes jobs.
   *
   * This method will start the queue and process jobs in the background.
   * It will emit the appropriate events based on the job's status.
   */
  public async start() {
    this.running = true;
    this.events.emit("queue_start", this.queue);
    this.processJobs();
    return this;
  }

  /**
   * Stops the queue and aborts all active jobs.
   *
   * This method will signal the corresponding AbortController so that
   * the job's execute() method (if it supports an AbortSignal parameter)
   * can clean up and exit.
   */
  public async stop() {
    this.running = false;
    for (const [jobId, controller] of this.activeJobSignals.entries()) {
      controller.abort();
      this.events.emit("job_aborting", this.queue, jobId);
    }
    this.activeJobSignals.clear();
    this.events.emit("queue_stop", this.queue);
    return this;
  }

  /**
   * Restarts the queue and aborts all active jobs.
   *
   * This method will stop the queue and clear all active jobs.
   * It will then restart the queue and process jobs in the background.
   */
  public async restart() {
    await this.stop();
    const jobs = await this.processing();
    jobs.forEach((job) => this.complete(job.id, null, new PermanentJobError("Queue Restarted")));
    this.activeJobPromises.forEach(({ reject }) =>
      reject(new PermanentJobError("Queue Restarted"))
    );
    this.activeJobPromises.clear();
    await this.start();
    return this;
  }
}
