/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ILimiter, LimiterScope } from "./ILimiter";

export class DelayLimiter implements ILimiter {
  /** In-memory state — not shared across processes. */
  public readonly scope: LimiterScope = "process";
  private nextAvailableTime: Date = new Date();
  /** Time of the most recent successful tryAcquire, used to undo on release. */
  private lastAcquireBaseline: number = 0;
  constructor(private delayInMilliseconds: number = 50) {}

  async canProceed(): Promise<boolean> {
    return Date.now() >= this.nextAvailableTime.getTime();
  }

  /**
   * Atomic: read-and-set runs in one synchronous slice with no awaits between
   * the check and the write.
   */
  async tryAcquire(): Promise<boolean> {
    const now = Date.now();
    if (now < this.nextAvailableTime.getTime()) {
      return false;
    }
    this.lastAcquireBaseline = this.nextAvailableTime.getTime();
    this.nextAvailableTime = new Date(now + this.delayInMilliseconds);
    return true;
  }

  async release(): Promise<void> {
    // Roll back the delay window so the next caller can proceed immediately.
    this.nextAvailableTime = new Date(this.lastAcquireBaseline);
  }

  async recordJobStart(): Promise<void> {
    this.nextAvailableTime = new Date(Date.now() + this.delayInMilliseconds);
  }

  async recordJobCompletion(): Promise<void> {
    // No action needed.
  }

  async getNextAvailableTime(): Promise<Date> {
    return this.nextAvailableTime;
  }

  async setNextAvailableTime(date: Date): Promise<void> {
    if (date > this.nextAvailableTime) {
      this.nextAvailableTime = date;
    }
  }
  async clear(): Promise<void> {
    this.nextAvailableTime = new Date();
  }
}
