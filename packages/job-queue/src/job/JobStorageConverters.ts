/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JobStorageFormat } from "../queue-storage/IQueueStorage";
import { JobStatus } from "../queue-storage/IQueueStorage";
import { Job, JobClass } from "./Job";

/**
 * Convert a date string to a Date object, or null if invalid
 */
function toDate(date: string | null | undefined): Date | null {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Convert a Date object to an ISO string, or null if invalid
 */
function dateToISOString(date: Date | null | undefined): string | null {
  if (!date) return null;
  return isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Convert storage format to Job class
 */
export function storageToClass<Input, Output>(
  details: JobStorageFormat<Input, Output>,
  jobClass: JobClass<Input, Output>,
  options?: {
    /** @deprecated renamed to includeLeaseOwner; both names accepted */
    readonly includeWorkerId?: boolean;
  }
): Job<Input, Output> {
  const includeLeaseOwner = options?.includeWorkerId ?? true;
  return new jobClass({
    id: details.id,
    jobRunId: details.job_run_id,
    queueName: details.queue,
    fingerprint: details.fingerprint,
    input: details.input as Input,
    output: details.output as Output,
    visibleAt: toDate(details.visible_at),
    createdAt: toDate(details.created_at)!,
    deadlineAt: toDate(details.deadline_at),
    lastAttemptedAt: toDate(details.last_attempted_at),
    completedAt: toDate(details.completed_at),
    progress: details.progress || 0,
    progressMessage: details.progress_message || "",
    progressDetails: details.progress_details ?? null,
    status: details.status as JobStatus,
    error: details.error ?? null,
    errorCode: details.error_code ?? null,
    attempts: details.attempts ?? 0,
    maxAttempts: details.max_attempts ?? 10,
    ...(includeLeaseOwner ? { leaseOwner: details.lease_owner ?? null } : {}),
    abort_requested_at: details.abort_requested_at ?? null,
    lease_expires_at: details.lease_expires_at ?? null,
  });
}

/**
 * Convert Job class to storage format
 */
export function classToStorage<Input, Output>(
  job: Job<Input, Output>,
  queueName: string
): JobStorageFormat<Input, Output> {
  const now = new Date().toISOString();
  return {
    id: job.id,
    job_run_id: job.jobRunId,
    queue: job.queueName || queueName,
    fingerprint: job.fingerprint,
    input: job.input,
    status: job.status,
    output: job.output ?? null,
    error: job.error === null ? null : String(job.error),
    error_code: job.errorCode || null,
    attempts: job.attempts ?? 0,
    max_attempts: job.maxAttempts ?? 10,
    visible_at: dateToISOString(job.visibleAt) ?? now,
    created_at: dateToISOString(job.createdAt) ?? now,
    deadline_at: dateToISOString(job.deadlineAt),
    last_attempted_at: dateToISOString(job.lastAttemptedAt),
    completed_at: dateToISOString(job.completedAt),
    progress: job.progress ?? 0,
    progress_message: job.progressMessage ?? "",
    progress_details: job.progressDetails ?? null,
    lease_owner: job.leaseOwner ?? null,
    abort_requested_at: job.abort_requested_at ?? null,
    lease_expires_at: job.lease_expires_at ?? null,
  };
}
