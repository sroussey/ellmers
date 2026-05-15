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

  /**
   * Token records the previous nextAvailableTime so release can roll back to
   * exactly the state before this acquire — even if other acquires (or
   * setNextAvailableTime calls) ran in between.
   */
  async tryAcquire(): Promise<unknown | null> {
    const now = Date.now();
    if (now < this.nextAvailableTime.getTime()) {
      return null;
    }
    const previous = this.nextAvailableTime.getTime();
    this.lastAcquireBaseline = previous;
    this.nextAvailableTime = new Date(now + this.delayInMilliseconds);
    return previous;
  }

  async release(token: unknown): Promise<void> {
    if (typeof token !== "number") return;
    // Only roll back if no later acquire/setNextAvailableTime moved the
    // window forward — otherwise we'd undo someone else's reservation.
    if (this.nextAvailableTime.getTime() === this.lastAcquireBaseline + this.delayInMilliseconds) {
      this.nextAvailableTime = new Date(token);
    }
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
