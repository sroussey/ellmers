/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import { ILimiter, LimiterScope } from "./ILimiter";

export const NULL_JOB_LIMITER = createServiceToken<ILimiter>("jobqueue.limiter.null");

/**
 * Null limiter that does nothing.
 */
export class NullLimiter implements ILimiter {
  public readonly scope: LimiterScope = "process";

  async tryAcquire(): Promise<boolean> {
    return true;
  }

  async release(): Promise<void> {
    // Do nothing
  }

  async canProceed(): Promise<boolean> {
    return true;
  }

  async recordJobStart(): Promise<void> {
    // Do nothing
  }

  async recordJobCompletion(): Promise<void> {
    // Do nothing
  }

  async getNextAvailableTime(): Promise<Date> {
    return new Date();
  }

  async setNextAvailableTime(date: Date): Promise<void> {
    // Do nothing
  }

  async clear(): Promise<void> {
    // Do nothing
  }
}
