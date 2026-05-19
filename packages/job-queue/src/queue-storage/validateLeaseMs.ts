/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Validates `leaseMs` / `extendLease ms` inputs across all job-queue
 * backends. NaN/Infinity produce "Invalid Date" ISO strings that
 * poison `lease_expires_at`; negative values immediately re-expire
 * the lease a worker just claimed. `0` is permitted (instant expiry).
 */
export function validateLeaseMs(ms: number, fieldName = "leaseMs"): void {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`${fieldName} must be a non-negative finite number; got ${ms}`);
  }
}
