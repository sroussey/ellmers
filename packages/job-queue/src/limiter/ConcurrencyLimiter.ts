/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import { ILimiter, LimiterScope } from "./ILimiter";

export const CONCURRENT_JOB_LIMITER = createServiceToken<ILimiter>("jobqueue.limiter.concurrent");

/**
 * Concurrency limiter that limits the number of concurrent jobs.
 */
export class ConcurrencyLimiter implements ILimiter {
  /** In-memory counter — not shared across processes. */
  public readonly scope: LimiterScope = "process";
  private currentRunningJobs: number = 0;
  private readonly maxConcurrentJobs: number;
  private nextAllowedStartTime: Date = new Date();

  constructor(maxConcurrentJobs: number) {
    this.maxConcurrentJobs = maxConcurrentJobs;
  }

  async canProceed(): Promise<boolean> {
    return (
      this.currentRunningJobs < this.maxConcurrentJobs &&
      Date.now() >= this.nextAllowedStartTime.getTime()
    );
  }

  /**
   * Atomic in JS's single-threaded sense: the read-then-increment runs without
   * an `await` between them, so no other task can interleave.
   */
  async tryAcquire(): Promise<boolean> {
    if (
      this.currentRunningJobs >= this.maxConcurrentJobs ||
      Date.now() < this.nextAllowedStartTime.getTime()
    ) {
      return false;
    }
    this.currentRunningJobs++;
    return true;
  }

  async release(): Promise<void> {
    this.currentRunningJobs = Math.max(0, this.currentRunningJobs - 1);
  }

  async recordJobStart(): Promise<void> {
    this.currentRunningJobs++;
  }

  async recordJobCompletion(): Promise<void> {
    this.currentRunningJobs = Math.max(0, this.currentRunningJobs - 1);
  }

  async getNextAvailableTime(): Promise<Date> {
    return this.currentRunningJobs > this.maxConcurrentJobs ? new Date() : new Date(Date.now() - 1);
  }

  async setNextAvailableTime(date: Date): Promise<void> {
    if (date > this.nextAllowedStartTime) {
      this.nextAllowedStartTime = date;
    }
  }

  async clear(): Promise<void> {
    this.currentRunningJobs = 0;
    this.nextAllowedStartTime = new Date();
  }
}
