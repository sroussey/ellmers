/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_LIMITS } from "@workglow/util";
import { JobStatus } from "../queue-storage/IQueueStorage";
import { JobError } from "./JobError";
import type { JobProgressListener, StreamEventLike } from "./JobQueueEventListeners";

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
  /**
   * OPTIONAL. Present only when the worker's transport can deliver stream
   * events. Jobs MUST NOT retain references to chunk buffers after calling
   * this (buffers may be transferred across a worker boundary and detached).
   *
   * Returns a promise that settles once the event has been delivered to the
   * in-process listeners. A job producing a large body SHOULD await it: the
   * emit path is otherwise a synchronous push, so a fast producer outruns a
   * slow consumer with nothing to pace it. A job that ignores the return
   * value keeps the previous fire-and-forget behavior.
   */
  emitStreamEvent?: (event: StreamEventLike) => void | Promise<void>;
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
  maxAttempts?: number;
  status?: JobStatus;
  createdAt?: Date;
  deadlineAt?: Date | null;
  lastAttemptedAt?: Date | null;
  visibleAt?: Date | null;
  completedAt?: Date | null;
  attempts?: number;
  progress?: number;
  progressMessage?: string;
  progressDetails?: Record<string, any> | null;
  /** The ID of the worker that currently holds the lease on this job, null if unclaimed */
  leaseOwner?: string | null;
  /** ISO timestamp when an abort was requested for this job (storage-layer concern) */
  abort_requested_at?: string | null;
  /** ISO timestamp when the current lease expires (storage-layer concern) */
  lease_expires_at?: string | null;
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
  public maxAttempts: number;
  public createdAt: Date;
  public fingerprint: string | undefined;
  public status: JobStatus = JobStatus.PENDING;
  public visibleAt: Date;
  public output: Output | null = null;
  public attempts: number = 0;
  public lastAttemptedAt: Date | null = null;
  public completedAt: Date | null = null;
  public deadlineAt: Date | null = null;
  public error: string | null = null;
  public errorCode: string | null = null;
  public progress: number = 0;
  public progressMessage: string = "";
  public progressDetails: Record<string, any> | null = null;
  /** The ID of the worker that currently holds the lease on this job */
  public leaseOwner: string | null = null;
  /** ISO timestamp when an abort was requested for this job (storage-layer concern) */
  public abort_requested_at: string | null = null;
  /** ISO timestamp when the current lease expires (storage-layer concern) */
  public lease_expires_at: string | null = null;

  constructor({
    queueName,
    input,
    jobRunId,
    id,
    error = null,
    errorCode = null,
    fingerprint = undefined,
    output = null,
    maxAttempts = DEFAULT_LIMITS.jobMaxAttempts,
    createdAt = new Date(),
    completedAt = null,
    status = JobStatus.PENDING,
    deadlineAt = null,
    attempts = 0,
    lastAttemptedAt = null,
    visibleAt = new Date(),
    progress = 0,
    progressMessage = "",
    progressDetails = null,
    leaseOwner = null,
    abort_requested_at = null,
    lease_expires_at = null,
  }: JobConstructorParam<Input, Output>) {
    this.visibleAt = visibleAt ?? new Date();
    this.createdAt = createdAt ?? new Date();
    this.lastAttemptedAt = lastAttemptedAt ?? null;
    this.deadlineAt = deadlineAt ?? null;
    this.completedAt = completedAt ?? null;

    this.queueName = queueName;
    this.id = id;
    this.jobRunId = jobRunId;
    this.status = status;
    this.fingerprint = fingerprint;
    this.input = input;
    this.maxAttempts = maxAttempts;
    this.attempts = attempts;
    this.output = output;
    this.error = error;
    this.errorCode = errorCode;
    this.progress = progress;
    this.progressMessage = progressMessage;
    this.progressDetails = progressDetails;
    this.leaseOwner = leaseOwner ?? null;
    this.abort_requested_at = abort_requested_at ?? null;
    this.lease_expires_at = lease_expires_at ?? null;
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
