/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TriggerConfigurationError } from "./TriggerError";

/**
 * The next fire time on a fixed period, measured from the PREVIOUS tick's
 * scheduled instant so handler duration never accumulates into the schedule.
 *
 * If the host was suspended past one or more whole periods, the missed periods
 * are dropped — the result jumps to the next future instant on the same phase
 * rather than replaying the backlog as a burst.
 */
export function nextFixedIntervalFireTime(fromMs: number, intervalMs: number): number {
  const next = fromMs + intervalMs;
  const now = Date.now();
  if (next > now) return next;
  const missedPeriods = Math.floor((now - next) / intervalMs) + 1;
  return next + missedPeriods * intervalMs;
}

/** Validates a period shared by the fixed-interval triggers. */
export function assertValidIntervalMs(intervalMs: number): number {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new TriggerConfigurationError(
      `intervalMs must be a positive integer, received ${String(intervalMs)}.`
    );
  }
  return intervalMs;
}
