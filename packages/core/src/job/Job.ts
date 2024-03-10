//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "../task/base/Task";

export enum JobStatus {
  PENDING = "NEW",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

// ===============================================================================

export type JobConstructorDetails = {
  queue?: string;
  taskType: string;
  input: TaskInput;
  output?: TaskOutput | null;
  error?: string | null;
  id?: unknown;
  fingerprint?: string;
  maxRetries?: number;
  status?: JobStatus;
  createdAt?: Date | string;
  deadlineAt?: Date | string | null;
  lastRanAt?: Date | string | null;
  runAfter?: Date | string | null;
  retries?: number;
};

export class Job {
  public id: unknown;
  public queue: string | undefined;
  public readonly taskType: string;
  public readonly input: TaskInput;
  public readonly maxRetries: number;
  public readonly createdAt: Date;
  public fingerprint: string | undefined;
  public status: JobStatus = JobStatus.PENDING;
  public runAfter: Date;
  public output: TaskOutput | null = null;
  public retries: number = 0;
  public lastRanAt: Date | null = null;
  public completedAt: Date | null = null;
  public deadlineAt: Date | null = null;
  public error: string | null = null;

  constructor({
    queue,
    taskType,
    input,
    error = null,
    id,
    fingerprint = undefined,
    output = null,
    maxRetries = 10,
    createdAt = new Date(),
    status = JobStatus.PENDING,
    deadlineAt = null,
    retries = 0,
    lastRanAt = null,
    runAfter = null,
  }: JobConstructorDetails) {
    if (typeof runAfter === "string") runAfter = new Date(runAfter);
    if (typeof lastRanAt === "string") lastRanAt = new Date(lastRanAt);
    if (typeof createdAt === "string") createdAt = new Date(createdAt);
    if (typeof deadlineAt === "string") deadlineAt = new Date(deadlineAt);

    this.id = id;
    this.fingerprint = fingerprint;
    this.queue = queue;
    this.taskType = taskType;
    this.input = input;
    this.maxRetries = maxRetries;
    this.createdAt = createdAt;
    this.runAfter = runAfter ?? createdAt;
    this.status = status;
    this.deadlineAt = deadlineAt;
    this.retries = retries;
    this.lastRanAt = lastRanAt;
    this.output = output;
    this.error = error;
  }
  execute(): Promise<TaskOutput> {
    throw new Error("Method not implemented.");
  }
}
