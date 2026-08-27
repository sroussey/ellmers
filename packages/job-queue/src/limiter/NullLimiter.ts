/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { ILimiter, LimiterScope } from "./ILimiter";

export const NULL_JOB_LIMITER = createServiceToken<ILimiter>("jobqueue.limiter.null");

/**
 * Null limiter that does nothing.
 */
export class NullLimiter implements ILimiter {
  public readonly scope: LimiterScope = "process";

  /** Sentinel token — non-null so callers' truthy checks see it as a success. */
  private static readonly SENTINEL = Symbol("NullLimiter.acquired");

  async tryAcquire(): Promise<unknown | null> {
    return NullLimiter.SENTINEL;
  }

  async release(_token: unknown): Promise<void> {}

  async complete(_token: unknown): Promise<void> {}

  async getNextAvailableTime(): Promise<Date> {
    return new Date();
  }

  async setNextAvailableTime(_date: Date): Promise<void> {}

  async clear(): Promise<void> {}
}
