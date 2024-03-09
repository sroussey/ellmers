//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { sleep } from "util/Misc";
import { TaskInput, TaskOutput } from "../task/Task";
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
  public abstract complete(id: unknown, output: TaskOutput, error?: string): Promise<void>;
  public abstract clear(): Promise<void>;
  public abstract outputForInput(taskType: string, input: TaskInput): Promise<TaskOutput | null>;
  public abstract executeJob(job: Job): Promise<void>;

  protected async processJob(job: Job) {
    try {
      this.limiter.recordJobStart();
      await this.executeJob(job); // Assume executeJob is your method for job processing
    } catch (error) {
      console.error(`Error processing job: ${error}`);
      if (error instanceof RetryError) {
        await this.limiter.setNextAvailableTime(error.retryDate);
      }
    } finally {
      this.limiter.recordJobCompletion();
    }
  }

  async processJobs() {
    while (true) {
      try {
        // Check the rate limiter for the next available time to process jobs
        const nextTime = await this.limiter.getNextAvailableTime();
        const waitTime = nextTime.getTime() - Date.now();

        if (waitTime > 0) {
          await sleep(waitTime + 10);
          // Wait until the next available time as determined by the limiter
          // plus a little so canProceed is ok and no race condition
        }

        // Check if we can proceed based on the limiter
        if (await this.limiter.canProceed()) {
          const job = await this.next(); // Fetch the next job
          if (job) {
            await this.processJob(job); // Process the job
          }
        } else {
          await sleep(this.waitDurationInMilliseconds); // Wait and retry if we can't proceed
        }
      } catch (error) {
        console.error(`Error in processJobs: ${error}`);
        await sleep(this.waitDurationInMilliseconds); // Prevent tight loop on error
      }
    }
  }
}
