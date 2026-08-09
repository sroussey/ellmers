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
  // A backward clock step leaves the phase anchor arbitrarily far in the future. A
  // period trigger must still fire every `intervalMs`, so re-anchor instead of
  // waiting the jump out; the phase it loses was a wall-clock artifact anyway.
  if (next > now) return Math.min(next, now + intervalMs);
  const missedPeriods = Math.floor((now - next) / intervalMs) + 1;
  return next + missedPeriods * intervalMs;
}

/**
 * The next fire time after a backoff `delayMs`, measured from the PREVIOUS tick's
 * scheduled instant, clamped to `(now, now + delayMs]` exactly as
 * {@link nextFixedIntervalFireTime} clamps to `(now, now + intervalMs]`.
 *
 * An anchor the host slept past would otherwise land in the past and be replayed
 * as a burst of `setTimeout(0)` ticks; one left in the FUTURE by a backward clock
 * step would stall the loop for the size of the step.
 */
export function nextBackoffFireTime(fromMs: number, delayMs: number): number {
  const target = fromMs + delayMs;
  const now = Date.now();
  return target > now ? Math.min(target, now + delayMs) : now + delayMs;
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
