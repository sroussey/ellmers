/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import { ILimiter, LimiterScope, RateLimiterOptions } from "./ILimiter";

export const EVENLY_SPACED_JOB_RATE_LIMITER = createServiceToken<ILimiter>(
  "jobqueue.limiter.rate.evenlyspaced"
);

/**
 * Rate limiter that spreads requests evenly across a time window.
 * Instead of allowing all requests up to the limit and then waiting,
 * this limiter spaces out the requests evenly across the window.
 */
export class EvenlySpacedRateLimiter implements ILimiter {
  /** In-memory per-instance state — not shared across processes. */
  public readonly scope: LimiterScope = "process";
  private readonly maxExecutions: number;
  private readonly windowSizeMs: number;
  private readonly idealInterval: number;
  private nextAvailableTime: number = Date.now();
  private lastStartTime: number = 0;
  private durations: number[] = [];
  /** Promise chain used to serialize concurrent {@link tryAcquire} callers. */
  private acquireChain: Promise<unknown> = Promise.resolve();

  constructor({ maxExecutions, windowSizeInSeconds }: RateLimiterOptions) {
    if (maxExecutions <= 0) {
      throw new Error("maxExecutions must be > 0");
    }
    if (windowSizeInSeconds <= 0) {
      throw new Error("windowSizeInSeconds must be > 0");
    }
    this.maxExecutions = maxExecutions;
    this.windowSizeMs = windowSizeInSeconds * 1_000;
    // If you want exactly maxExecutions in windowSize, start one every this many ms:
    this.idealInterval = this.windowSizeMs / this.maxExecutions;
  }

  /** Can we start a new job right now? */
  async canProceed(): Promise<boolean> {
    const now = Date.now();
    return now >= this.nextAvailableTime;
  }

  /**
   * Atomic acquire: serialized by an internal promise chain so two concurrent
   * acquirers cannot both observe `now >= nextAvailableTime` and both proceed.
   * Returns a token capturing the prior `nextAvailableTime` so {@link release}
   * can roll back to the exact state before this acquire.
   */
  async tryAcquire(): Promise<unknown | null> {
    const previous = this.acquireChain;
    let release!: (v: unknown) => void;
    const next = new Promise((r) => {
      release = r;
    });
    this.acquireChain = next;
    try {
      await previous;
      const now = Date.now();
      if (now < this.nextAvailableTime) {
        return null;
      }
      const priorNextAvailable = this.nextAvailableTime;
      // Reserve the slot by advancing nextAvailableTime now (recordJobStart-style)
      // so a follow-up tryAcquire from another caller in the same tick blocks.
      this.lastStartTime = now;
      if (this.durations.length === 0) {
        this.nextAvailableTime = now + this.idealInterval;
      } else {
        const sum = this.durations.reduce((a, b) => a + b, 0);
        const avgDuration = sum / this.durations.length;
        const waitMs = Math.max(0, this.idealInterval - avgDuration);
        this.nextAvailableTime = now + waitMs;
      }
      return { priorNextAvailable, advancedTo: this.nextAvailableTime };
    } finally {
      release(undefined);
    }
  }

  /**
   * Roll back the slot identified by `token`. Only undoes the advance if no
   * later acquire moved the window forward — otherwise we'd undo someone
   * else's reservation.
   */
  async release(token: unknown): Promise<void> {
    if (
      !token ||
      typeof token !== "object" ||
      typeof (token as { advancedTo?: unknown }).advancedTo !== "number"
    ) {
      return;
    }
    const t = token as { priorNextAvailable: number; advancedTo: number };
    if (this.nextAvailableTime === t.advancedTo) {
      this.nextAvailableTime = t.priorNextAvailable;
    }
  }

  /** Record that a job is starting now. */
  async recordJobStart(): Promise<void> {
    const now = Date.now();
    this.lastStartTime = now;

    // If no timing data yet, assume zero run-time (ideal interval)
    if (this.durations.length === 0) {
      this.nextAvailableTime = now + this.idealInterval;
    } else {
      // Compute average run duration
      const sum = this.durations.reduce((a, b) => a + b, 0);
      const avgDuration = sum / this.durations.length;
      // Schedule next start: ideal spacing minus average duration
      const waitMs = Math.max(0, this.idealInterval - avgDuration);
      this.nextAvailableTime = now + waitMs;
    }
  }

  /**
   * Call this when a job finishes.
   * We measure its duration, update our running-average,
   * and then compute how long to wait before the next job start.
   */
  async recordJobCompletion(): Promise<void> {
    const now = Date.now();
    const duration = now - this.lastStartTime;
    this.durations.push(duration);
    if (this.durations.length > this.maxExecutions) {
      this.durations.shift();
    }
  }

  async getNextAvailableTime(): Promise<Date> {
    return new Date(this.nextAvailableTime);
  }

  async setNextAvailableTime(date: Date): Promise<void> {
    const t = date.getTime();
    if (t > this.nextAvailableTime) {
      this.nextAvailableTime = t;
    }
  }

  async clear(): Promise<void> {
    this.durations = [];
    this.nextAvailableTime = Date.now();
    this.lastStartTime = 0;
  }
}
