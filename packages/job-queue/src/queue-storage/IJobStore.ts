/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageId, SendOptions } from "./IMessageQueue";
import type { JobStatus, JobStorageFormat } from "./IQueueStorage";

/**
 * Record describing a stored job.
 */
export type JobRecord<Input, Output> = JobStorageFormat<Input, Output>;

/**
 * Read- and mutation-side of the job queue. Paired with
 * {@link IMessageQueue}.
 */
export interface IJobStore<Input, Output> {
  /**
   * Declared durability of the backing store, surfaced from
   * {@link IQueueStorage.durable} by the wrapper facade. `false` marks a
   * store whose rows do not survive the process (in-memory); undefined
   * means durable. Cloud message-queue adapters key their pairing warning
   * on this flag.
   */
  readonly durable?: boolean;
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
  deleteByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void>;
  /** Delete a single job by id. */
  delete(id: MessageId): Promise<void>;
  /** Delete every job in this store. */
  deleteAll(): Promise<void>;
  abort(id: MessageId): Promise<void>;
  /** Force-overwrite the status field without incrementing attempts. Used to persist DISABLED after lease release. */
  saveStatus(id: MessageId, status: JobStatus): Promise<void>;

  /**
   * Insert a new job record built from a {@link JobStorageFormat} body and
   * {@link SendOptions}. Sets status to PENDING, generates the id, persists
   * fingerprint / job_run_id / max_attempts / deadline_at — and applies
   * `delaySeconds` to `visible_at` where the storage preserves caller-set
   * visibility — then returns the generated id. Used by message-queue
   * adapters that don't share a SQL core with the store (SQS, Cloudflare
   * Queues). SQL backends should delegate to their existing native insert
   * path.
   */
  create(body: JobStorageFormat<Input, Output>, opts: SendOptions): Promise<MessageId>;

  /**
   * Return the existing PENDING or PROCESSING record for the given
   * `fingerprint` within this queue, if any. Used by cloud-queue adapters to
   * implement fingerprint deduplication uniformly (without relying on
   * native dedup features of the underlying transport).
   *
   * Backends with a unique partial index on `(queue, fingerprint) WHERE
   * status IN ('PENDING','PROCESSING')` should use it for O(1) lookup;
   * in-memory backends do a scan.
   */
  findActiveByFingerprint(
    fingerprint: string,
    queueName: string
  ): Promise<JobRecord<Input, Output> | undefined>;

  /**
   * Batch read by id. Returns records in the same order as `ids`, with
   * `undefined` for ids that don't exist. Default fallback implementation
   * may loop {@link get}; native backends should override with a single
   * `WHERE id IN (...)` query.
   */
  getMany(ids: readonly MessageId[]): Promise<readonly (JobRecord<Input, Output> | undefined)[]>;

  /**
   * Atomically write `output` and set status to COMPLETED in a single
   * storage operation. Used by message-queue adapters that don't share a
   * pending-buffer core with the store (SQS, Cloudflare Queues) so the
   * "ack atomically persists the result" guarantee from {@link IClaim.ack}
   * can be honored end-to-end.
   */
  completeWithResult(id: MessageId, result: Output): Promise<void>;

  /**
   * Atomically write error fields and set status to FAILED in a single
   * storage operation. Counterpart to {@link completeWithResult} for the
   * failure path; honors {@link IClaim.fail}'s atomicity guarantee for
   * cloud adapters.
   */
  failWithError(
    id: MessageId,
    opts: {
      readonly error?: string | null;
      readonly errorCode?: string | null;
      readonly abortRequested?: boolean;
    }
  ): Promise<void>;

  /**
   * Atomically write status=DISABLED, release the lease, clear progress
   * fields, and stamp `completed_at` in a single storage operation.
   * Counterpart to {@link completeWithResult} / {@link failWithError} for
   * the disable path; honors {@link IClaim.disable}'s atomicity guarantee
   * for cloud adapters whose worker does not share a wrapped core with the
   * store (SQS, Cloudflare Queues). Does NOT write error/error_code —
   * DISABLED is not an error transition.
   */
  markDisabled(id: MessageId): Promise<void>;

  /**
   * Mark a row's enqueue as deferred after a transient producer-side
   * failure: set `visible_at` to a future timestamp (backoff) and stash an
   * `error_code` (e.g. "ENQUEUE_FAILED") WITHOUT touching `status` or
   * `attempts`. The row stays PENDING so a future poll or producer retry
   * will pick it up again.
   *
   * Used by cloud adapters (SQS, Cloudflare Queues) whose `send`/`sendBatch`
   * may throw with the row already inserted: instead of overwriting PENDING
   * with FAILED — which would permanently lose the job for any consumer
   * polling for PENDING work — we shift `visible_at` forward and let the
   * normal retry surface (or operator action) drive recovery.
   *
   * Implementations that don't currently persist `visible_at` outside the
   * status state machine may log + no-op, but should at minimum not throw
   * and not corrupt other fields. SQL backends should issue a single
   * `UPDATE ... SET visible_at = ..., error_code = ... WHERE id = ...`.
   */
  markEnqueueDeferred(
    id: MessageId,
    opts: { readonly visible_at: Date; readonly errorCode: string }
  ): Promise<void>;

  /**
   * Batch counterpart to {@link markEnqueueDeferred}. Used by cloud-queue
   * adapters whose `sendBatch` may throw with N rows already inserted:
   * a serial `for...await markEnqueueDeferred` loop turns one transient
   * network failure into N sequential DB round-trips and often outlives
   * the caller's deadline.
   *
   * The default {@link WrappedJobStore} implementation uses
   * `Promise.allSettled` to fan out the per-id writes in parallel and
   * returns a structured `{ failed }` list rather than throwing on the
   * first error — callers (sendBatch) log each failed id and surface the
   * aggregate via their existing `AggregateError`. A custom IJobStore backed
   * by native SQL may override with a single `UPDATE ... WHERE id = ANY($1)`
   * round-trip.
   *
   * Optional: the wrapper layer provides a default implementation so
   * adapters can call this method as `jobStore.markEnqueueDeferredMany!`
   * confident a fallback is present even if a custom IJobStore doesn't
   * implement it natively.
   */
  markEnqueueDeferredMany?(
    ids: readonly MessageId[],
    opts: { readonly visible_at: Date; readonly errorCode: string }
  ): Promise<{ failed: readonly { id: MessageId; err: unknown }[] }>;
}
