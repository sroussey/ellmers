//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import uuid from "uuid";
import { Job, JobConstructorDetails, JobQueue, JobStatus, makeFingerprint } from "./JobQueue";
import { TaskInput } from "lib";

// ===============================================================================
//                               Local Version
// ===============================================================================

export class LocalJob extends Job {
  constructor(details: JobConstructorDetails) {
    if (!details.id) details.id = uuid.v4();
    super(details);
  }
}

export class LocalJobQueue extends JobQueue {
  private jobQueue: LocalJob[] = [];

  #reorderQueue(): void {
    this.jobQueue
      .filter((job) => job.status === JobStatus.PENDING)
      .filter((job) => job.runAfter.getTime() <= Date.now())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  public async add(job: Job) {
    this.jobQueue.push(job);
  }

  public async get(id: string) {
    return this.jobQueue.find((j) => j.id === id);
  }

  public async peek(num: number) {
    num = Number(num) || 100;
    return this.jobQueue.slice(0, num);
  }

  public async next() {
    this.#reorderQueue();

    const job = this.jobQueue[0];
    job.status = JobStatus.PROCESSING;
    return job;
  }

  public async size(): Promise<number> {
    return this.jobQueue.length;
  }

  public async complete(id: unknown, output: any, error?: string) {
    const job = this.jobQueue.find((j) => j.id === id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    job.completedAt = new Date();
    if (error) {
      job.error = error;
      if (job.retries >= job.maxRetries) {
        job.status = JobStatus.FAILED;
      } else {
        job.status = JobStatus.PENDING;
      }
    } else {
      job.status = JobStatus.COMPLETED;
      job.output = output;
    }
  }

  public async clear() {
    this.jobQueue = [];
  }

  public async outputForInput(taskType: string, input: TaskInput) {
    const fingerprint = makeFingerprint(input);
    return (
      this.jobQueue.find(
        (j) =>
          j.taskType === taskType &&
          j.fingerprint === fingerprint &&
          j.status === JobStatus.COMPLETED
      )?.output ?? null
    );
  }
}
