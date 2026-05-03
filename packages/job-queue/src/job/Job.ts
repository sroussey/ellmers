/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { JobStatus } from "../queue-storage/IQueueStorage";
import { JobError } from "./JobError";
import type { JobProgressListener } from "./JobQueueEventListeners";

export { JobStatus };

/**
 * Context for job execution
 */
export interface IJobExecuteContext {
  signal: AbortSignal;
  updateProgress: (
    progress: number,
    message?: string,
    details?: Record<string, any> | null
  ) => Promise<void>;
}

/**
 * Details about a job that reflect the structure in the database.
 */
export type JobConstructorParam<Input, Output> = {
  id?: unknown;
  jobRunId?: string;
  queueName?: string;
  input: Input;
  output?: Output | null;
  error?: string | null;
  errorCode?: string | null;
  fingerprint?: string;
  maxRetries?: number;
  status?: JobStatus;
  createdAt?: Date;
  deadlineAt?: Date | null;
  lastRanAt?: Date | null;
  runAfter?: Date | null;
  completedAt?: Date | null;
  runAttempts?: number;
  progress?: number;
  progressMessage?: string;
  progressDetails?: Record<string, any> | null;
  /** The ID of the worker that claimed this job, null if unclaimed */
  workerId?: string | null;
};

export type JobClass<Input, Output> = new (
  param: JobConstructorParam<Input, Output>
) => Job<Input, Output>;

/**
 * A job that can be executed by a JobQueue.
 *
 * @template Input - The type of the job's input
 * @template Output - The type of the job's output
 */
export class Job<Input, Output> {
  public id: unknown;
  public jobRunId: string | undefined;
  public queueName: string | undefined;
  public input: Input;
  public maxRetries: number;
  public createdAt: Date;
  public fingerprint: string | undefined;
  public status: JobStatus = JobStatus.PENDING;
  public runAfter: Date;
  public output: Output | null = null;
  public runAttempts: number = 0;
  public lastRanAt: Date | null = null;
  public completedAt: Date | null = null;
  public deadlineAt: Date | null = null;
  public error: string | null = null;
  public errorCode: string | null = null;
  public progress: number = 0;
  public progressMessage: string = "";
  public progressDetails: Record<string, any> | null = null;
  /** The ID of the worker that claimed this job */
  public workerId: string | null = null;

  constructor({
    queueName,
    input,
    jobRunId,
    id,
    error = null,
    errorCode = null,
    fingerprint = undefined,
    output = null,
    maxRetries = 10,
    createdAt = new Date(),
    completedAt = null,
    status = JobStatus.PENDING,
    deadlineAt = null,
    runAttempts = 0,
    lastRanAt = null,
    runAfter = new Date(),
    progress = 0,
    progressMessage = "",
    progressDetails = null,
    workerId = null,
  }: JobConstructorParam<Input, Output>) {
    this.runAfter = runAfter ?? new Date();
    this.createdAt = createdAt ?? new Date();
    this.lastRanAt = lastRanAt ?? null;
    this.deadlineAt = deadlineAt ?? null;
    this.completedAt = completedAt ?? null;

    this.queueName = queueName;
    this.id = id;
    this.jobRunId = jobRunId;
    this.status = status;
    this.fingerprint = fingerprint;
    this.input = input;
    this.maxRetries = maxRetries;
    this.runAttempts = runAttempts;
    this.output = output;
    this.error = error;
    this.errorCode = errorCode;
    this.progress = progress;
    this.progressMessage = progressMessage;
    this.progressDetails = progressDetails;
    this.workerId = workerId ?? null;
  }

  async execute(_input: Input, _context: IJobExecuteContext): Promise<Output> {
    throw new JobError("Method not implemented.");
  }

  public progressListeners: Set<JobProgressListener> = new Set();

  /**
   * Update the job's progress (for direct execution without a worker)
   * @param progress - Progress value between 0 and 100
   * @param message - Optional progress message
   * @param details - Optional progress details
   */
  public async updateProgress(
    progress: number,
    message: string = "",
    details: Record<string, any> | null = null
  ): Promise<void> {
    this.progress = progress;
    this.progressMessage = message;
    this.progressDetails = details;

    // Notify direct listeners
    for (const listener of this.progressListeners) {
      listener(progress, message, details);
    }
  }

  /**
   * Adds a progress listener for this job
   *
   * Only used if run directly (not via a queue)
   *
   * @param listener - The callback function to be called when progress updates occur
   * @returns A cleanup function to remove the listener
   */
  public onJobProgress(listener: JobProgressListener): () => void {
    this.progressListeners.add(listener);

    return () => {
      this.progressListeners.delete(listener);
    };
  }
}
