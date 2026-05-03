/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";

export const JOB_LIMITER = createServiceToken<ILimiter>("jobqueue.limiter");

/**
 * Whether a limiter's state is shared across processes.
 *
 * - `"process"` — state lives in this process only. Multiple workers in the
 *   same process share it, but separate processes do not. The configured limit
 *   is multiplied by the number of processes.
 * - `"cluster"` — state lives in shared storage (Postgres, Supabase, etc.)
 *   visible to every process in the cluster. The configured limit is enforced
 *   globally.
 */
export type LimiterScope = "process" | "cluster";

/**
 * Interface for a job limiter.
 *
 * The atomic primitive is {@link tryAcquire}: it both checks whether a job may
 * proceed and reserves the slot in a single uninterruptible step. Callers
 * MUST use {@link tryAcquire}/{@link release} (not the legacy
 * {@link canProceed}/{@link recordJobStart} pair) when correctness matters
 * under concurrency.
 */
export interface ILimiter {
  /**
   * Whether this limiter's state is shared across processes. See
   * {@link LimiterScope}. In-memory limiters MUST report `"process"` so users
   * don't mistake them for cluster-safe.
   */
  readonly scope: LimiterScope;

  /**
   * Atomic check-and-record. Returns `true` iff a slot was reserved (i.e. the
   * caller may proceed AND the reservation has been recorded). Returns `false`
   * without side effects if the limiter is at capacity.
   *
   * Implementations must be safe under concurrent callers — two parallel
   * `tryAcquire()` calls with one slot remaining must result in exactly one
   * `true` and one `false`.
   */
  tryAcquire(): Promise<boolean>;

  /**
   * Release a slot previously reserved by {@link tryAcquire}. Used when the
   * caller cannot actually use the slot it acquired (e.g. claimed a job that
   * vanished, executor failed before running, worker shut down).
   */
  release(): Promise<void>;

  /**
   * Legacy non-binding "would tryAcquire succeed?" probe. SUBJECT TO RACES —
   * do not use this followed by {@link recordJobStart} in production code; use
   * {@link tryAcquire} instead. Retained for observability and tests.
   */
  canProceed(): Promise<boolean>;

  /**
   * Legacy "force-record an execution" hook. SUBJECT TO RACES when paired with
   * {@link canProceed} — use {@link tryAcquire} instead. Retained for tests
   * and external bookkeeping.
   */
  recordJobStart(): Promise<void>;

  recordJobCompletion(): Promise<void>;
  getNextAvailableTime(): Promise<Date>;
  setNextAvailableTime(date: Date): Promise<void>;
  clear(): Promise<void>;
}

export interface RateLimiterOptions {
  readonly maxExecutions: number;
  readonly windowSizeInSeconds: number;
}

export interface RateLimiterWithBackoffOptions extends RateLimiterOptions {
  readonly initialBackoffDelay?: number;
  readonly backoffMultiplier?: number;
  readonly maxBackoffDelay?: number;
}
