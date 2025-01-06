//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { ILimiter } from "./ILimiter";
import { Job, JobStatus } from "./Job";

export class RetryError extends Error {
  constructor(public retryDate: Date, message: string) {
    super(message);
    this.name = "RetryError";
  }
}

type JobEvents =
  | "queue_start"
  | "queue_stop"
  | "job_start"
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
  public abstract size(status?: JobStatus): Promise<number>;
  public abstract complete(id: unknown, output?: Output | null, error?: string): Promise<void>;
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
    } catch (error) {
      console.error(`Error processing job: ${error}`);
      if (error instanceof RetryError) {
        this.events.emit("job_retry", this.queue, job.id, error.retryDate);
        await this.limiter.setNextAvailableTime(error.retryDate);
      }
      await this.complete(job.id, null, String(error));
    } finally {
      await this.limiter.recordJobCompletion();
    }
  }

  private waits = new Map();
  /**
   *  This method is called when a job is really completed, after retries etc.
   */
  protected onCompleted(jobId: unknown, status: JobStatus, output: Output | null, error?: string) {
    // Find the job by jobId and resolve its promise if it exists
    const job = this.waits.get(jobId);
    if (job) {
      if (status === JobStatus.FAILED) {
        this.events.emit("job_error", this.queue, jobId, error);
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
  }

  async stop() {
    this.running = false;
    this.events.emit("queue_stop", this.queue);
  }

  async restart() {
    await this.stop(); // if not already
    const jobs = await this.processing();
    jobs.forEach((job) => this.complete(job.id, null, "Queue Restarted"));
    this.waits.forEach(({ reject }) => reject("Queue Restarted"));
    this.waits.clear();
    await this.start();
  }
}
