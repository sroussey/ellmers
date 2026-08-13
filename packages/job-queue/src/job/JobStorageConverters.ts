/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_LIMITS } from "@workglow/util";
import type { JobStatus, JobStorageFormat } from "../queue-storage/IQueueStorage";
import type { Job, JobClass } from "./Job";

/**
 * Convert a date string to a Date object, or null if invalid
 */
function toDate(date: string | null | undefined): Date | null {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Convert storage format to Job class
 */
export function storageToClass<Input, Output>(
  details: JobStorageFormat<Input, Output>,
  jobClass: JobClass<Input, Output>
): Job<Input, Output> {
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
    maxAttempts: details.max_attempts ?? DEFAULT_LIMITS.jobMaxAttempts,
    leaseOwner: details.lease_owner ?? null,
    abort_requested_at: details.abort_requested_at ?? null,
    lease_expires_at: details.lease_expires_at ?? null,
  });
}
