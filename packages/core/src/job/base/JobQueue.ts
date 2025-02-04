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

  events = new EventEmitter<JobEvents>();

  on(event: JobEvents, listener: (...args: any[]) => void) {
    return this.events.on(event, listener);
  }
  off(event: JobEvents, listener?: (...args: any[]) => void) {
    return this.events.off(event, listener);
  }

  // we do this in case the queue needs to do something queue specific to execute the job
  public async executeJob(job: Job<Input, Output>): Promise<Output> {
    return await job.execute();
  }

  protected async processJob(job: Job<Input, Output>) {
    try {
      await this.limiter.recordJobStart();
      this.events.emit("job_start", this.queue, job.id);
      const output = await this.executeJob(job);
      await this.complete(job.id, output);
    } catch (err: any) {
      console.error(`Error processing job: ${err}`);

      if (err instanceof RetryableJobError) {
        // Emit a retry event and let the concrete implementation update scheduling
        this.events.emit("job_retry", this.queue, job.id, err.retryDate);
      } else if (err instanceof PermanentJobError) {
        // Emit an error event for permanent errors
        this.events.emit("job_error", this.queue, job.id, err.message);
      } else {
        // For any generic error, treat it as permanent by wrapping it in a PermanentJobError
        err = new PermanentJobError(err.message || String(err));
        this.events.emit("job_error", this.queue, job.id, err.message);
      }

      // Pass the error object (instead of its string) to the complete() method
      await this.complete(job.id, null, err);
    } finally {
      await this.limiter.recordJobCompletion();
    }
  }

  private waits = new Map();
  /**
   *  This method is called when a job is really completed, after retries etc.
   */
  protected onCompleted(
    jobId: unknown,
    status: JobStatus,
    output: Output | null,
    error?: JobError
  ) {
    // Find the job by jobId and resolve its promise if it exists
    const job = this.waits.get(jobId);
    if (job) {
      if (status === JobStatus.FAILED) {
        this.events.emit("job_error", this.queue, jobId, `${error!.name}: ${error!.message}`);
        job.reject(error);
      } else if (status === JobStatus.COMPLETED) {
        this.events.emit("job_complete", this.queue, jobId, output);
        job.resolve(output);
      }
      // Remove the job from the map after completion
      this.waits.delete(jobId);
    }
  }

  waitFor(jobId: unknown): Promise<Output> {
    // Return a new promise for the job
    return new Promise((resolve, reject) => {
      // Store the resolve and reject functions in the map using jobId as the key
      // This allows us to resolve or reject the promise later when onCompleted is called
      this.waits.set(jobId, { resolve, reject });
    });
  }

  private running = false;
  private async processJobs() {
    if (!this.running) return; // Stop processing if the queue has been stopped

    try {
      const canProceed = await this.limiter.canProceed();
      if (canProceed) {
        const job = await this.next(); // Fetch the next job if available
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

  async start() {
    this.running = true;
    this.events.emit("queue_start", this.queue);
    this.processJobs();
    return this;
  }

  async stop() {
    this.running = false;
    this.events.emit("queue_stop", this.queue);
    return this;
  }

  async restart() {
    await this.stop(); // if not already
    const jobs = await this.processing();
    jobs.forEach((job) => this.complete(job.id, null, new PermanentJobError("Queue Restarted")));
    this.waits.forEach(({ reject }) => reject(new PermanentJobError("Queue Restarted")));
    this.waits.clear();
    await this.start();
    return this;
  }
}
