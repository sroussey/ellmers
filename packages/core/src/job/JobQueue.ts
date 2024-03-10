//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "../task/base/Task";
import { ILimiter } from "./ILimiter";
import { Job, JobStatus } from "./Job";

export class RetryError extends Error {
  constructor(
    public retryDate: Date,
    message: string
  ) {
    super(message);
    this.name = "RetryError";
  }
}

export abstract class JobQueue {
  constructor(
    public readonly queue: string,
    protected limiter: ILimiter,
    protected waitDurationInMilliseconds: number
  ) {}
  public abstract add(job: Job): Promise<unknown>;
  public abstract get(id: unknown): Promise<Job | undefined>;
  public abstract next(): Promise<Job | undefined>;
  public abstract peek(num: number): Promise<Array<Job>>;
  public abstract size(status?: JobStatus): Promise<number>;
  public abstract complete(id: unknown, output?: TaskOutput | null, error?: string): Promise<void>;
  public abstract clear(): Promise<void>;
  public abstract outputForInput(taskType: string, input: TaskInput): Promise<TaskOutput | null>;

  // we do this in case the queue needs to do something queue specific to execute the job
  public async executeJob(job: Job): Promise<TaskOutput> {
    return await job.execute();
  }

  protected async processJob(job: Job) {
    try {
      await this.limiter.recordJobStart();
      const output = await this.executeJob(job);
      await this.complete(job.id, output);
    } catch (error) {
      console.error(`Error processing job: ${error}`);
      if (error instanceof RetryError) {
        await this.limiter.setNextAvailableTime(error.retryDate);
      }
      await this.complete(job.id, null, String(error));
    } finally {
      await this.limiter.recordJobCompletion();
    }
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

  start() {
    this.running = true;
    this.processJobs();
  }

  stop() {
    this.running = false;
  }
}
