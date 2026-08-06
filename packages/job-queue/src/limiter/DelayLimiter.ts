/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ILimiter, LimiterScope } from "./ILimiter";

export class DelayLimiter implements ILimiter {
  /** In-memory state — not shared across processes. */
  public readonly scope: LimiterScope = "process";
  private nextAvailableTime: Date = new Date();
  /** The value tryAcquire last advanced nextAvailableTime to, so release can
   *  tell whether a later acquire/setNextAvailableTime superseded it. */
  private lastAdvancedTo: number = 0;
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
    this.nextAvailableTime = new Date(now + this.delayInMilliseconds);
    this.lastAdvancedTo = this.nextAvailableTime.getTime();
    return previous;
  }

  async release(token: unknown): Promise<void> {
    if (typeof token !== "number") return;
    // Only roll back if our advance is still the current window — otherwise a
    // later acquire/setNextAvailableTime moved it forward and we'd undo theirs.
    if (this.nextAvailableTime.getTime() === this.lastAdvancedTo) {
      this.nextAvailableTime = new Date(token);
    }
  }

  async complete(_token: unknown): Promise<void> {
    // No-op — the delay window reservation must persist until the window expires.
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
