/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TriggerConfigurationError } from "./TriggerError";

/**
 * Shared numeric-bound guard for every trigger option that is a count or a
 * duration.
 *
 * Deliberately NOT exported from `src/common.ts`: it is an internal invariant
 * helper, not public API. It lives in its own module rather than in
 * `BaseTrigger.ts` so the workflow bindings — which validate
 * `maxPendingFires` but do not extend `BaseTrigger` — report the same
 * invariant with the same message and the same error type.
 *
 * `Number.isInteger` already rejects `NaN`, `±Infinity` and non-integers, so
 * the `< 1` half only has to rule out zero and negatives.
 */
export function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TriggerConfigurationError(
      `${name} must be a positive integer, received ${String(value)}.`
    );
  }
  return value;
}
