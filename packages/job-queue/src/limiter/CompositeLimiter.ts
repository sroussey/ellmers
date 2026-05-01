/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ILimiter, LimiterScope } from "./ILimiter";

export class CompositeLimiter implements ILimiter {
  private limiters: ILimiter[] = [];

  constructor(limiters: ILimiter[] = []) {
    this.limiters = limiters;
  }

  /**
   * `"cluster"` only when EVERY child is cluster-scoped. A single process-scoped
   * child means the composite as a whole can't enforce a cluster-wide limit.
   */
  public get scope(): LimiterScope {
    return this.limiters.every((l) => l.scope === "cluster") && this.limiters.length > 0
      ? "cluster"
      : "process";
  }

  addLimiter(limiter: ILimiter): void {
    this.limiters.push(limiter);
  }

  async canProceed(): Promise<boolean> {
    for (const limiter of this.limiters) {
      if (!(await limiter.canProceed())) {
        return false; // If any limiter says "no", proceed no further
      }
    }
    return true; // All limiters agree
  }

  /**
   * Atomic against the composite: acquires children sequentially and rolls
   * back any successfully-acquired prefix if a later child rejects, so the
   * "all-or-nothing" semantics hold under concurrency.
   */
  async tryAcquire(): Promise<boolean> {
    const acquired: ILimiter[] = [];
    for (const limiter of this.limiters) {
      const ok = await limiter.tryAcquire();
      if (!ok) {
        // Roll back the partial acquisition.
        for (const previous of acquired.reverse()) {
          try {
            await previous.release();
          } catch {
            // best-effort
          }
        }
        return false;
      }
      acquired.push(limiter);
    }
    return true;
  }

  async release(): Promise<void> {
    await Promise.all(this.limiters.map((l) => l.release().catch(() => {})));
  }

  async recordJobStart(): Promise<void> {
    await Promise.all(this.limiters.map((limiter) => limiter.recordJobStart()));
  }

  async recordJobCompletion(): Promise<void> {
    await Promise.all(this.limiters.map((limiter) => limiter.recordJobCompletion()));
  }

  async getNextAvailableTime(): Promise<Date> {
    let maxDate = new Date(); // Assume now as the default
    for (const limiter of this.limiters) {
      const limiterNextTime = await limiter.getNextAvailableTime();
      if (limiterNextTime > maxDate) {
        maxDate = limiterNextTime; // Find the latest time among limiters
      }
    }
    return maxDate;
  }

  async setNextAvailableTime(date: Date): Promise<void> {
    for (const limiter of this.limiters) {
      await limiter.setNextAvailableTime(date);
    }
  }

  async clear(): Promise<void> {
    await Promise.all(this.limiters.map((limiter) => limiter.clear()));
  }
}
