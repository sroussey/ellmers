//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "../task/Task";
import { ILimiter } from "./ILimiter";
import { Job, JobStatus } from "./Job";

export abstract class JobQueue {
  constructor(
    public readonly queue: string,
    protected limiter: ILimiter
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

  protected async processJobAsync(job: Job) {
    try {
      this.limiter.recordJobStart();
      await this.executeJob(job); // Assume executeJob is your method for job processing
    } finally {
      this.limiter.recordJobCompletion();
    }
  }
}
