/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { PrefixColumn } from "../queue-storage/IQueueStorage";

export const RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>("ratelimiter.storage");

/**
 * Whether a rate-limiter storage's state is shared across processes.
 *
 * - `"process"` — in-memory / per-process state. Multiple workers in the same
 *   process share it, but separate processes do not.
 * - `"cluster"` — state lives in shared external storage (Postgres, Supabase,
 *   etc.) visible to every process.
 */
export type RateLimiterStorageScope = "process" | "cluster";

/**
 * Options for configuring rate limiter storage with prefix filters.
 */
export interface RateLimiterStorageOptions {
  /** The prefix column definitions for this storage */
  readonly prefixes?: readonly PrefixColumn[];
  /** The values for each prefix column */
  readonly prefixValues?: Readonly<Record<string, string | number>>;
}

/**
 * Record of a job execution for rate limiting tracking.
 */
export interface ExecutionRecord {
  readonly id?: unknown;
  readonly queue_name: string;
  readonly executed_at: string;
}

/**
 * Record of the next available time for a queue.
 */
export interface NextAvailableRecord {
  readonly queue_name: string;
  readonly next_available_at: string;
}

/**
 * Interface defining the storage operations for a rate limiter.
 * This separates the storage concerns from the rate limiting logic.
 */
export interface IRateLimiterStorage {
  /**
   * Whether this storage is shared across processes. In-memory backends MUST
   * report `"process"`. Shared databases (Postgres, Supabase) report
   * `"cluster"`.
   */
  readonly scope: RateLimiterStorageScope;

  /**
   * Applies any pending migrations for this rate limiter's tables. The
   * single schema-setup entry point for every backend; in-memory backends
   * implement it as a no-op.
   */
  migrate(): Promise<void>;

  /**
   * Returns this storage's versioned migrations for composition with other
   * storages' migrations under a single `MigrationRunner`. Returns an empty
   * array on backends without a versioned schema (in-memory).
   */
  getMigrations(): ReadonlyArray<unknown>;

  /**
   * Atomic check-and-record. Inserts an execution row and returns the
   * inserted row's id iff BOTH (a) fewer than `maxExecutions` rows have
   * `executed_at > (now - windowMs)` AND (b) any persisted `nextAvailableAt`
   * is in the past or absent. Returns `null` without writing anything
   * otherwise.
   *
   * The returned id MUST be passed to {@link releaseExecution} to free the
   * slot — otherwise concurrent acquirers would race to delete the wrong
   * worker's row when one of them rolls back.
   *
   * Implementations MUST serialize concurrent callers (advisory locks,
   * `BEGIN IMMEDIATE`, per-key mutex, etc.) so the count-then-insert window
   * is uninterruptible.
   *
   * @param queueName - The name of the queue
   * @param maxExecutions - Max allowed executions in the window
   * @param windowMs - Window size in milliseconds
   * @returns the inserted row's id on success, or `null` on failure
   */
  tryReserveExecution(
    queueName: string,
    maxExecutions: number,
    windowMs: number
  ): Promise<unknown | null>;

  /**
   * Release the execution row identified by `token` (the value previously
   * returned from {@link tryReserveExecution}). No-op if the row no longer
   * exists.
   *
   * Critical: implementations MUST delete by id, NOT by recency or position.
   * Two concurrent workers can hold tokens for different rows; deleting the
   * "most recent" row would release another worker's reservation.
   */
  releaseExecution(queueName: string, token: unknown): Promise<void>;

  /**
   * Records a job execution for rate limiting tracking.
   * @param queueName - The name of the queue
   */
  recordExecution(queueName: string): Promise<void>;

  /**
   * Gets the count of executions within a time window.
   * @param queueName - The name of the queue
   * @param windowStartTime - The start of the time window (ISO string)
   * @returns The count of executions within the window
   */
  getExecutionCount(queueName: string, windowStartTime: string): Promise<number>;

  /**
   * Gets the oldest execution time within the window, offset by a count.
   * Used to calculate when the rate limit will allow the next execution.
   * @param queueName - The name of the queue
   * @param offset - The offset (typically maxExecutions - 1)
   * @returns The execution time or undefined if not enough executions
   */
  getOldestExecutionAtOffset(queueName: string, offset: number): Promise<string | undefined>;

  /**
   * Gets the next available time for a queue.
   * @param queueName - The name of the queue
   * @returns The next available time or undefined if not set
   */
  getNextAvailableTime(queueName: string): Promise<string | undefined>;

  /**
   * Sets the next available time for a queue.
   * @param queueName - The name of the queue
   * @param nextAvailableAt - The next available time (ISO string)
   */
  setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void>;

  /**
   * Clears all rate limit entries for a queue.
   * @param queueName - The name of the queue
   */
  clear(queueName: string): Promise<void>;
}
