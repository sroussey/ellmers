/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageId } from "./IMessageQueue";

export type { MessageId };

/** Optional shape passed by `IClaim.fail` to communicate the failure reason. */
export interface ClaimFailOptions {
  /** Human-readable error message persisted as `error`. */
  readonly error?: string | null;
  /** Machine-readable error code persisted as `error_code`. */
  readonly errorCode?: string | null;
  /**
   * True when the failure was caused by an abort request. The claim's
   * implementation persists `abort_requested_at` accordingly (some backends
   * keep a previously-set value if this is false).
   */
  readonly abortRequested?: boolean;
  /**
   * Hint: this failure must not be retried. Consumers may use this to skip
   * back-off scheduling. Storage layers may ignore the flag (the worker
   * still owns retry-vs-fail orchestration via attempts/max_attempts).
   */
  readonly permanent?: boolean;
}

/** Optional shape passed by `IClaim.disable` (currently empty — kept for forward compat). */
export type ClaimDisableOptions = Record<string, never>;

/**
 * A claim on a message from the queue.
 *
 * A claim is created when a worker calls {@link IMessageQueue.receive}. It
 * represents an exclusive (leased) right to process the message. The worker
 * must terminate the claim via one of {@link IClaim.ack},
 * {@link IClaim.retry}, {@link IClaim.fail}, {@link IClaim.disable}, or by
 * letting the lease expire.
 */
export interface IClaim<Body> {
  readonly id: MessageId;
  readonly body: Body;
  readonly attempts: number;
  /**
   * Mark the message as successfully processed (terminal). Optional `result`
   * is persisted atomically with the COMPLETED status so a crash between
   * "save result" and "ack" can no longer leave a PROCESSING row with a
   * result the worker thinks it stored. The shape of `result` depends on
   * the message body; for job-queue claims this is the typed `Output`.
   */
  ack(result?: unknown): Promise<void>;
  /** Release the claim and reschedule for a later attempt. */
  retry(opts?: { delaySeconds?: number }): Promise<void>;
  /**
   * Mark the message as failed (terminal). Error/errorCode/abortRequested
   * are persisted atomically with the FAILED status. The `permanent` flag
   * is a hint to skip back-off scheduling; storage layers may ignore it.
   */
  fail(opts?: ClaimFailOptions): Promise<void>;
  /** Extend the lease by `ms` milliseconds. */
  extendLease(ms: number): Promise<void>;
  /**
   * Mark the message as DISABLED (terminal). Atomic: writes status =
   * DISABLED, releases the lease, and clears progress fields in a single
   * storage write. Does NOT write error/error_code — DISABLED is not an
   * error transition.
   */
  disable(opts?: ClaimDisableOptions): Promise<void>;
}
