/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ILimiter, LimiterScope } from "./ILimiter";

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

  /**
   * Atomic against the composite: acquires children sequentially and rolls
   * back any successfully-acquired prefix if a later child rejects, so the
   * "all-or-nothing" semantics hold under concurrency.
   *
   * The returned token is an array of per-child tokens (parallel to
   * `this.limiters`) so {@link release} can free each child's specific slot
   * — never "the most recent", which would race other acquirers.
   */
  async tryAcquire(): Promise<unknown | null> {
    const tokens: unknown[] = [];
    for (const limiter of this.limiters) {
      const t = await limiter.tryAcquire();
      if (t === null || t === undefined) {
        // Roll back the partial acquisition. Iterate in reverse so children
        // are released in opposite order of acquisition.
        for (let i = tokens.length - 1; i >= 0; i--) {
          try {
            await this.limiters[i].release(tokens[i]);
          } catch {
            // best-effort
          }
        }
        return null;
      }
      tokens.push(t);
    }
    return tokens;
  }

  async release(token: unknown): Promise<void> {
    if (!Array.isArray(token)) return;
    await Promise.all(this.limiters.map((l, i) => l.release(token[i]).catch(() => {})));
  }

  async complete(token: unknown): Promise<void> {
    if (!Array.isArray(token)) return;
    await Promise.all(this.limiters.map((l, i) => l.complete(token[i]).catch(() => {})));
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
