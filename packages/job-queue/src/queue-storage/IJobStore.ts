/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageId } from "./IMessageQueue";
import type { JobStatus, JobStorageFormat } from "./IQueueStorage";

/**
 * Record describing a stored job. Currently an alias for the legacy
 * {@link JobStorageFormat} so adapters and native implementations can share
 * the same record shape.
 */
export type JobRecord<Input, Output> = JobStorageFormat<Input, Output>;

/**
 * Read- and mutation-side of the job queue. Paired with
 * {@link IMessageQueue}.
 */
export interface IJobStore<Input, Output> {
  get(id: MessageId): Promise<JobRecord<Input, Output> | undefined>;
  peek(status?: JobStatus, num?: number): Promise<readonly JobRecord<Input, Output>[]>;
  size(status?: JobStatus): Promise<number>;
  getByRunId(runId: string): Promise<readonly JobRecord<Input, Output>[]>;
  outputForInput(input: Input): Promise<Output | null>;
  saveProgress(
    id: MessageId,
    progress: number,
    message: string,
    details: Record<string, any> | null
  ): Promise<void>;
  saveResult(id: MessageId, output: Output): Promise<void>;
  saveError(
    id: MessageId,
    error: string,
    errorCode: string | null,
    abortRequested: boolean
  ): Promise<void>;
  deleteByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void>;
  /** Delete a single job by id. */
  delete(id: MessageId): Promise<void>;
  /** Delete every job in this store. */
  deleteAll(): Promise<void>;
  abort(id: MessageId): Promise<void>;
  /** Force-overwrite the status field without incrementing attempts. Used to persist DISABLED after lease release. */
  saveStatus(id: MessageId, status: JobStatus): Promise<void>;
}
