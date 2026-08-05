/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { ILimiter, LimiterScope } from "./ILimiter";

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

  /** Sentinel token; ConcurrencyLimiter has no per-row identity, just a counter. */
  private static readonly SENTINEL = Symbol("ConcurrencyLimiter.acquired");

  /**
   * Atomic in JS's single-threaded sense: the read-then-increment runs without
   * an `await` between them, so no other task can interleave.
   */
  async tryAcquire(): Promise<unknown | null> {
    if (
      this.currentRunningJobs >= this.maxConcurrentJobs ||
      Date.now() < this.nextAllowedStartTime.getTime()
    ) {
      return null;
    }
    this.currentRunningJobs++;
    return ConcurrencyLimiter.SENTINEL;
  }

  async release(token: unknown): Promise<void> {
    if (token !== ConcurrencyLimiter.SENTINEL) return;
    this.currentRunningJobs = Math.max(0, this.currentRunningJobs - 1);
  }

  async complete(token: unknown): Promise<void> {
    // Guard on the sentinel exactly like release() does. Without this, a
    // duplicate complete(), a complete() after a release(), or a complete()
    // with a foreign/undefined token would decrement a slot this limiter never
    // handed out, permanently over-admitting concurrency (floored at 0) until
    // clear().
    if (token !== ConcurrencyLimiter.SENTINEL) return;
    this.currentRunningJobs = Math.max(0, this.currentRunningJobs - 1);
  }

  async getNextAvailableTime(): Promise<Date> {
    // A free slot exists only when running < max. At or above max the next
    // slot frees on an (unscheduled) job completion, so the soonest we can
    // promise is "now". Either way, never report earlier than a pending
    // rate-delay window set via setNextAvailableTime.
    const earliest =
      this.currentRunningJobs >= this.maxConcurrentJobs ? Date.now() : Date.now() - 1;
    return new Date(Math.max(earliest, this.nextAllowedStartTime.getTime()));
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
