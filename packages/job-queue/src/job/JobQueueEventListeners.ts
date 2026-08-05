/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";

/**
 * Events that can be emitted by the JobQueue
 */
export type JobQueueEventListeners<Input, Output> = {
  queue_start: (queueName: string) => void;
  queue_stop: (queueName: string) => void;
  job_start: (queueName: string, jobId: unknown) => void;
  job_aborting: (queueName: string, jobId: unknown) => void;
  job_complete: (queueName: string, jobId: unknown, output: Output) => void;
  job_error: (queueName: string, jobId: unknown, error: string, errorCode?: string) => void;
  job_disabled: (queueName: string, jobId: unknown) => void;
  job_retry: (queueName: string, jobId: unknown, visibleAt: Date) => void;
  job_progress: (
    queueName: string,
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, any> | null
  ) => void;
  job_stream: (queueName: string, jobId: unknown, event: StreamEventLike) => void;
};

export type JobQueueEvents = keyof JobQueueEventListeners<any, any>;

export type JobQueueEventListener<Event extends JobQueueEvents> = JobQueueEventListeners<
  any,
  any
>[Event];

export type JobQueueEventParameters<Event extends JobQueueEvents, Input, Output> = EventParameters<
  JobQueueEventListeners<Input, Output>,
  Event
>;
/**
 * Type for progress event listener callback
 */
export type JobProgressListener = (
  progress: number,
  message: string,
  details: Record<string, any> | null
) => void;

/**
 * Minimal structural shape of a stream event crossing the job-queue boundary.
 *
 * `@workglow/job-queue` sits below `@workglow/task-graph` in the dependency
 * graph, so it cannot import task-graph's `StreamEvent`. This structural type
 * captures just what the queue plumbing needs; task-graph's `StreamEvent` is
 * assignable to it, so real stream producers interoperate transparently.
 */
export type StreamEventLike = { type: string; port?: string; [k: string]: unknown };

/** Listener for cross-process stream events emitted by an executing job. */
export type JobStreamListener = (event: StreamEventLike) => void;

/**
 * A single {@link StreamEventLike} tagged with its job id and a monotonic,
 * 1-based per-job sequence number. The unit of a job's cross-process stream
 * side-channel: a producer appends rows in `seq` order; a consumer reorders and
 * de-duplicates by `seq` (see `StreamReassembler`) before dispatch.
 */
export interface StreamChunkRow {
  readonly jobId: unknown;
  readonly seq: number;
  readonly event: StreamEventLike;
}
