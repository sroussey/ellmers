/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";

/**
 * Run `op` with bounded exponential backoff. Used by SqsClaim.ack / .fail
 * to make the JobStore terminal write resilient to transient failures —
 * the SQS message has already been deleted by the time we get here, so a
 * single thrown write would strand the row in PROCESSING until the
 * lease-expiry sweep notices.
 *
 * Defaults: 3 attempts, 200ms base → 200ms / 400ms / 800ms backoffs.
 * Logs at error and rethrows the last error if every attempt fails so
 * the caller still sees the failure surface.
 */
export async function persistWithRetry(
  op: () => Promise<void>,
  ctx: string,
  maxAttempts = 3,
  baseDelayMs = 200
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await op();
      return;
    } catch (e) {
      lastErr = e;
      // Don't sleep after the final attempt — we're about to throw.
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  getLogger().error(`[${ctx}] persistence failed after retries`, { err: lastErr });
  throw lastErr;
}
