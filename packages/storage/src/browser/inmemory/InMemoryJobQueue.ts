//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { nanoid } from "nanoid";
import {
  Job,
  JobStatus,
  JobQueue,
  ILimiter,
  JobError,
  RetryableJobError,
  PermanentJobError,
  sleep,
} from "ellmers-core";
import { makeFingerprint } from "../../util/Misc";

/**
 * In-memory implementation of a job queue that manages asynchronous tasks.
 * Supports job scheduling, status tracking, and result caching.
 */
export class InMemoryJobQueue<Input, Output> extends JobQueue<Input, Output> {
  /**
   * Creates a new in-memory job queue
   * @param queue - Name of the queue
   * @param limiter - Rate limiter to control job execution
   * @param waitDurationInMilliseconds - Polling interval for checking new jobs
   * @param jobClass - Optional custom Job class implementation
   */
  constructor(
    queue: string,
    limiter: ILimiter,
    jobClass: typeof Job<Input, Output> = Job<Input, Output>,
    waitDurationInMilliseconds = 100
  ) {
    super(queue, limiter, jobClass, waitDurationInMilliseconds);
    this.jobQueue = [];
  }

  /** Internal array storing all jobs */
  private jobQueue: Job<Input, Output>[];

  /**
   * Returns a filtered and sorted list of pending jobs that are ready to run
   * Sorts by creation time to maintain FIFO order
   */
  private reorderedQueue() {
    return this.jobQueue
      .filter((job) => job.status === JobStatus.PENDING)
      .filter((job) => job.runAfter.getTime() <= Date.now())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Adds a new job to the queue
   * Generates an ID and fingerprint if not provided
   */
  public async add(job: Job<Input, Output>) {
    job.id = job.id ?? nanoid();
    job.jobRunId = job.jobRunId ?? nanoid();
    job.queueName = this.queue;
    job.fingerprint = await makeFingerprint(job.input);
    job.status = JobStatus.PENDING;
    this.createAbortController(job.id);
    this.jobQueue.push(job);
    return job.id;
  }

  public async get(id: unknown) {
    const result = this.jobQueue.find((j) => j.id === id);
    return result ? this.createNewJob(result, false) : undefined;
  }

  public async peek(num: number) {
    num = Number(num) || 100;
    return this.jobQueue.slice(0, num).map((j) => this.createNewJob(j, false));
  }

  public async processing() {
    return this.jobQueue
      .filter((job) => job.status === JobStatus.PROCESSING)
      .map((j) => this.createNewJob(j, false));
  }

  public async aborting() {
    return this.jobQueue
      .filter((job) => job.status === JobStatus.ABORTING)
      .map((j) => this.createNewJob(j, false));
  }

  /**
   * Retrieves the next available job that is ready to be processed
   * Updates the job status to PROCESSING before returning
   */
  public async next() {
    const top = this.reorderedQueue();

    const job = top[0];
    if (job) {
      job.status = JobStatus.PROCESSING;
      return this.createNewJob(job, false);
    }
  }

  public async size(status = JobStatus.PENDING): Promise<number> {
    return this.jobQueue.filter((j) => j.status === status).length;
  }

  /**
   * Marks a job as complete with its output or error
   * Handles retries for failed jobs and triggers completion callbacks
   * @param id - ID of the job to complete
   * @param output - Result of the job execution
   * @param error - Optional error message if job failed
   */
  public async complete(id: unknown, output: Output, error?: JobError) {
    await sleep(0); // ensure does not run straight through and thus act like the others
    const job = this.jobQueue.find((j) => j.id === id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }

    if (error) {
      job.error = error.message;
      job.errorCode = error.name;
      if (error instanceof RetryableJobError) {
        job.retries++;
        if (job.retries >= job.maxRetries) {
          job.status = JobStatus.FAILED;
          job.completedAt = new Date();
        } else {
          job.status = JobStatus.PENDING;
          job.runAfter = error.retryDate;
        }
      } else if (error instanceof PermanentJobError) {
        job.status = JobStatus.FAILED;
        job.completedAt = new Date();
      } else {
        job.status = JobStatus.FAILED;
        job.completedAt = new Date();
      }
    } else {
      job.status = JobStatus.COMPLETED;
      job.completedAt = new Date();
      job.output = output;
      job.error = null;
      job.errorCode = null;
    }

    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      this.onCompleted(job.id, job.status, output, error);
    }
  }

  public async abort(jobId: unknown) {
    const job = this.jobQueue.find((j) => j.id === jobId);
    if (job) {
      job.status = JobStatus.ABORTING;
    }
    this.abortJob(jobId);
  }

  public async getJobsByRunId(jobRunId: string): Promise<Array<Job<Input, Output>>> {
    return this.jobQueue
      .filter((job) => job.jobRunId === jobRunId)
      .map((j) => this.createNewJob(j, false));
  }

  public async deleteAll() {
    this.jobQueue = [];
  }

  /**
   * Looks up cached output for a given task type and input
   * Uses input fingerprinting for efficient matching
   * @returns The cached output or null if not found
   */
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
