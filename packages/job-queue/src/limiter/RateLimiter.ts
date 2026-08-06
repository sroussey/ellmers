/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRateLimiterStorage } from "../rate-limiter-storage/IRateLimiterStorage";
import type { ILimiter, LimiterScope, RateLimiterWithBackoffOptions } from "./ILimiter";

/**
 * Base rate limiter implementation that uses a storage backend.
 * Manages request counts and delays to control job execution.
 */
export class RateLimiter implements ILimiter {
  protected readonly windowSizeInMilliseconds: number;
  protected currentBackoffDelay: number;
  protected readonly maxExecutions: number;
  protected readonly initialBackoffDelay: number;
  protected readonly backoffMultiplier: number;
  protected readonly maxBackoffDelay: number;
  /**
   * Per-instance backoff hint set by the most recent failed {@link tryAcquire}.
   * Exposed via {@link getNextAvailableTime} so this process's worker sleeps
   * until the hint expires, but NOT written to storage so a parallel worker's
   * {@link release} can't clobber it. Cross-process workers each maintain
   * their own hint.
   */
  protected localBackoffUntilMs: number = 0;

  constructor(
    protected readonly storage: IRateLimiterStorage,
    protected readonly queueName: string,
    {
      maxExecutions,
      windowSizeInSeconds,
      initialBackoffDelay = 1_000,
      backoffMultiplier = 2,
      maxBackoffDelay = 600_000, // 10 minutes
    }: RateLimiterWithBackoffOptions
  ) {
    if (maxExecutions <= 0) {
      throw new Error("maxExecutions must be greater than 0");
    }
    if (windowSizeInSeconds <= 0) {
      throw new Error("windowSizeInSeconds must be greater than 0");
    }
    if (initialBackoffDelay <= 0) {
      throw new Error("initialBackoffDelay must be greater than 0");
    }
    if (backoffMultiplier <= 1) {
      throw new Error("backoffMultiplier must be greater than 1");
    }
    if (maxBackoffDelay <= initialBackoffDelay) {
      throw new Error("maxBackoffDelay must be greater than initialBackoffDelay");
    }

    this.windowSizeInMilliseconds = windowSizeInSeconds * 1000;
    this.maxExecutions = maxExecutions;
    this.initialBackoffDelay = initialBackoffDelay;
    this.backoffMultiplier = backoffMultiplier;
    this.maxBackoffDelay = maxBackoffDelay;
    this.currentBackoffDelay = initialBackoffDelay;
  }

  /**
   * Inherits its scope from the underlying storage. Storage-backed RateLimiter
   * is `"cluster"` for Postgres/Supabase, `"process"` for InMemory/IndexedDb/Sqlite.
   */
  public get scope(): LimiterScope {
    return this.storage.scope;
  }

  /**
   * Atomic check-and-record. Delegates to {@link IRateLimiterStorage.tryReserveExecution}
   * which performs the count, next-available, and insert under a single
   * critical section per backend (advisory xact lock for Postgres, BEGIN
   * IMMEDIATE for SQLite, per-key promise mutex for in-memory).
   *
   * Returns the storage-assigned row id as an opaque token on success, or
   * `null` on failure. The caller MUST pass the token to {@link release} to
   * roll back — releasing without a token would race to delete the wrong
   * worker's slot under contention.
   */
  async tryAcquire(): Promise<unknown | null> {
    const token = await this.storage.tryReserveExecution(
      this.queueName,
      this.maxExecutions,
      this.windowSizeInMilliseconds
    );
    if (token !== null && token !== undefined) {
      this.currentBackoffDelay = this.initialBackoffDelay;
      this.localBackoffUntilMs = 0;
      return token;
    }

    // Capacity reached — apply jittered exponential backoff. We hold this
    // hint on the instance only; writing to the shared storage sentinel
    // would race with parallel acquire/release calls (a peer's release()
    // could clobber our hint, and clobbering the storage sentinel is
    // dangerous because tryReserveExecution treats it as a hard gate).
    this.localBackoffUntilMs = Date.now() + this.addJitter(this.currentBackoffDelay);
    this.increaseBackoff();
    return null;
  }

  /**
   * Release the slot identified by `token` (a value returned from
   * {@link tryAcquire}). Deletes the specific row by id — NOT the most recent
   * — so two concurrent acquirers don't race to release each other's slots.
   * Does NOT touch the shared storage `nextAvailableAt` sentinel; that field
   * is reserved for explicit external pauses (e.g. cluster-wide rate-limit
   * cool-down set via {@link setNextAvailableTime}), and clearing it here
   * would clobber a parallel worker's failed-acquire backoff or a deliberate
   * cluster-wide pause. Local per-instance backoff is cleared via
   * {@link localBackoffUntilMs}.
   */
  async release(token: unknown): Promise<void> {
    if (token === null || token === undefined) return;
    await this.storage.releaseExecution(this.queueName, token);
    this.currentBackoffDelay = this.initialBackoffDelay;
    this.localBackoffUntilMs = 0;
  }

  /**
   * No-op for RateLimiter — the window reservation was consumed and must
   * persist until the window expires.
   */
  async complete(_token: unknown): Promise<void> {
    return Promise.resolve();
  }

  protected addJitter(base: number): number {
    // full jitter in [base, 2*base)
    return base + Math.random() * base;
  }

  protected increaseBackoff(): void {
    this.currentBackoffDelay = Math.min(
      this.currentBackoffDelay * this.backoffMultiplier,
      this.maxBackoffDelay
    );
  }

  /**
   * Retrieves the next available time for the specific queue. Returns the
   * latest of: the rate-limit wall (oldest execution + window), any externally
   * set storage sentinel (explicit pause), and this instance's local backoff
   * hint from the most recent failed {@link tryAcquire}.
   */
  async getNextAvailableTime(): Promise<Date> {
    // Get the time when the rate limit will allow the next job execution
    const oldestExecution = await this.storage.getOldestExecutionAtOffset(
      this.queueName,
      this.maxExecutions - 1
    );

    let latestMs = Date.now();
    if (oldestExecution) {
      latestMs = Math.max(
        latestMs,
        new Date(oldestExecution).getTime() + this.windowSizeInMilliseconds
      );
    }

    // External pause set via setNextAvailableTime (cluster-visible).
    const nextAvailableStr = await this.storage.getNextAvailableTime(this.queueName);
    if (nextAvailableStr) {
      latestMs = Math.max(latestMs, new Date(nextAvailableStr).getTime());
    }

    // Local backoff hint from the most recent failed tryAcquire on this
    // instance — keeps this process's worker from re-acquiring before the
    // hint expires without polluting cluster state.
    if (this.localBackoffUntilMs > latestMs) {
      latestMs = this.localBackoffUntilMs;
    }

    return new Date(latestMs);
  }

  /**
   * Sets the next available time for the specific queue.
   * @param date - The new next available time
   */
  async setNextAvailableTime(date: Date): Promise<void> {
    await this.storage.setNextAvailableTime(this.queueName, date.toISOString());
  }

  /**
   * Clears all rate limit entries for this queue.
   */
  async clear(): Promise<void> {
    await this.storage.clear(this.queueName);
    this.currentBackoffDelay = this.initialBackoffDelay;
    this.localBackoffUntilMs = 0;
  }
}
