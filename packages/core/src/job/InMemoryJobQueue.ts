//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { makeFingerprint } from "../util/Misc";
import { Job, JobStatus } from "./base/Job";
import { JobQueue } from "./base/JobQueue";
import { ILimiter } from "./base/ILimiter";
import { nanoid } from "nanoid";

export class InMemoryJobQueue<Input, Output> extends JobQueue<Input, Output> {
  constructor(queue: string, limiter: ILimiter, waitDurationInMilliseconds = 100) {
    super(queue, limiter, waitDurationInMilliseconds);
    this.jobQueue = [];
  }

  private jobQueue: Job<Input, Output>[];

  private reorderedQueue() {
    return this.jobQueue
      .filter((job) => job.status === JobStatus.PENDING)
      .filter((job) => job.runAfter.getTime() <= Date.now())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  public async add(job: Job<Input, Output>) {
    job.id = job.id ?? nanoid();
    job.queueName = this.queue;
    job.fingerprint = await makeFingerprint(job.input);
    this.jobQueue.push(job);
    return job.id;
  }

  public async get(id: unknown) {
    return this.jobQueue.find((j) => j.id === id);
  }

  public async peek(num: number) {
    num = Number(num) || 100;
    return this.jobQueue.slice(0, num);
  }

  public async processing() {
    return this.jobQueue.filter((job) => job.status === JobStatus.PROCESSING);
  }

  public async next() {
    const top = this.reorderedQueue();

    const job = top[0];
    if (job) {
      job.status = JobStatus.PROCESSING;
      return job;
    }
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
      job.retries += 1;
      if (job.retries >= job.maxRetries) {
        job.status = JobStatus.FAILED;
      } else {
        job.status = JobStatus.PENDING;
      }
    } else {
      job.status = JobStatus.COMPLETED;
      job.output = output;
    }
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      this.onCompleted(job.id, job.status, output, error);
    }
  }

  public async clear() {
    this.jobQueue = [];
  }

  public async outputForInput(taskType: string, input: Input) {
    const fingerprint = await makeFingerprint(input);
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
