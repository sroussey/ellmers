/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IRateLimiterStorage } from "@workglow/storage";
import { ILimiter, LimiterScope, RateLimiterWithBackoffOptions } from "./ILimiter";

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
   */
  async tryAcquire(): Promise<boolean> {
    const reserved = await this.storage.tryReserveExecution(
      this.queueName,
      this.maxExecutions,
      this.windowSizeInMilliseconds
    );
    if (reserved) {
      this.currentBackoffDelay = this.initialBackoffDelay;
      // Clear any stale backoff that was set by a previous failed acquire.
      const next = await this.storage.getNextAvailableTime(this.queueName);
      if (next && new Date(next).getTime() > Date.now()) {
        await this.storage.setNextAvailableTime(
          this.queueName,
          new Date(Date.now() - 1000).toISOString()
        );
      }
      return true;
    }

    // Capacity reached — apply jittered exponential backoff so callers don't
    // hammer the storage on every wake.
    const backoffExpires = new Date(Date.now() + this.addJitter(this.currentBackoffDelay));
    const existing = await this.storage.getNextAvailableTime(this.queueName);
    if (!existing || new Date(existing).getTime() < backoffExpires.getTime()) {
      await this.storage.setNextAvailableTime(this.queueName, backoffExpires.toISOString());
    }
    this.increaseBackoff();
    return false;
  }

  /**
   * Release the slot reserved by the most recent {@link tryAcquire}. Best-effort:
   * removes the most recent execution row AND clears any backoff written by
   * a previous failed acquire so a follow-up tryAcquire isn't blocked by a
   * now-stale "next available at" sentinel.
   */
  async release(): Promise<void> {
    await this.storage.releaseExecution(this.queueName);
    const next = await this.storage.getNextAvailableTime(this.queueName);
    if (next && new Date(next).getTime() > Date.now()) {
      await this.storage.setNextAvailableTime(
        this.queueName,
        new Date(Date.now() - 1000).toISOString()
      );
    }
    this.currentBackoffDelay = this.initialBackoffDelay;
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
   * Checks if a job can proceed based on rate limiting rules.
   * @returns True if the job can proceed, false otherwise
   */
  async canProceed(): Promise<boolean> {
    // First check if the window allows more executions
    const windowStartTime = new Date(Date.now() - this.windowSizeInMilliseconds).toISOString();
    const attemptCount = await this.storage.getExecutionCount(this.queueName, windowStartTime);
    const canProceedNow = attemptCount < this.maxExecutions;

    // If the window allows more executions, clear any backoff and proceed
    if (canProceedNow) {
      // Clear any existing nextAvailableTime backoff since the window allows more executions
      const nextAvailableTime = await this.storage.getNextAvailableTime(this.queueName);
      if (nextAvailableTime && new Date(nextAvailableTime).getTime() > Date.now()) {
        // Clear the backoff by setting it to the past
        const pastTime = new Date(Date.now() - 1000);
        await this.storage.setNextAvailableTime(this.queueName, pastTime.toISOString());
      }
      this.currentBackoffDelay = this.initialBackoffDelay;
      return true;
    }

    // Window is full, check if there's a backoff delay
    const nextAvailableTime = await this.storage.getNextAvailableTime(this.queueName);
    if (nextAvailableTime && new Date(nextAvailableTime).getTime() > Date.now()) {
      this.increaseBackoff();
      return false;
    }

    // Window is full but no backoff delay, so we can't proceed
    this.increaseBackoff();
    return false;
  }

  /**
   * Records a new job attempt.
   */
  async recordJobStart(): Promise<void> {
    await this.storage.recordExecution(this.queueName);

    const windowStartTime = new Date(Date.now() - this.windowSizeInMilliseconds).toISOString();
    const attemptCount = await this.storage.getExecutionCount(this.queueName, windowStartTime);

    if (attemptCount >= this.maxExecutions) {
      const backoffExpires = new Date(Date.now() + this.addJitter(this.currentBackoffDelay));
      await this.setNextAvailableTime(backoffExpires);
    } else {
      // Window allows more executions, clear any existing nextAvailableTime by setting it to the past
      const nextAvailableTime = await this.storage.getNextAvailableTime(this.queueName);
      if (nextAvailableTime && new Date(nextAvailableTime).getTime() > Date.now()) {
        // Clear the backoff since the window now allows more executions
        // Set to a time in the past to effectively clear it
        const pastTime = new Date(Date.now() - 1000);
        await this.storage.setNextAvailableTime(this.queueName, pastTime.toISOString());
      }
    }
  }

  async recordJobCompletion(): Promise<void> {
    // Implementation can be no-op as completion doesn't affect rate limiting
  }

  /**
   * Retrieves the next available time for the specific queue.
   * @returns The next available time
   */
  async getNextAvailableTime(): Promise<Date> {
    // Get the time when the rate limit will allow the next job execution
    const oldestExecution = await this.storage.getOldestExecutionAtOffset(
      this.queueName,
      this.maxExecutions - 1
    );

    let rateLimitedTime = new Date();
    if (oldestExecution) {
      rateLimitedTime = new Date(oldestExecution);
      rateLimitedTime.setSeconds(
        rateLimitedTime.getSeconds() + this.windowSizeInMilliseconds / 1000
      );
    }

    // Get the next available time set externally, if any
    const nextAvailableStr = await this.storage.getNextAvailableTime(this.queueName);
    let nextAvailableTime = new Date();
    if (nextAvailableStr) {
      nextAvailableTime = new Date(nextAvailableStr);
    }

    return nextAvailableTime > rateLimitedTime ? nextAvailableTime : rateLimitedTime;
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
  }
}
