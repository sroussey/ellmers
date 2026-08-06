/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
import type { IJobStore } from "./IJobStore";
import type { MessageId } from "./IMessageQueue";

/**
 * Backoff applied to `visible_at` when an enqueue throws transiently. Keeps
 * the row PENDING so a subsequent producer retry / poll picks it up again
 * instead of marking it FAILED on the first network blip.
 */
export const ENQUEUE_DEFER_BACKOFF_MS = 30_000;

/**
 * Clamp the defer interval to the original `delaySeconds` floor so a row
 * with a legitimate large delay (e.g. 1h scheduled work) is NOT pulled
 * forward to now + 30s by a producer-side blip. Returns the maximum of the
 * original delay and the producer-retry backoff so:
 *   - delaySeconds = 0   → wait 30s before next producer attempt
 *   - delaySeconds = 3600 → wait 3600s (the original schedule)
 */
export function computeDeferDelayMs(originalDelaySeconds: number | undefined): number {
  const original = originalDelaySeconds != null ? originalDelaySeconds * 1000 : 0;
  return Math.max(original, ENQUEUE_DEFER_BACKOFF_MS);
}

/**
 * Fallback used when the underlying `IJobStore` does not implement the
 * optional `markEnqueueDeferredMany` (a bare custom store, etc.). Mirrors
 * the WrappedJobStore default impl: parallel per-id writes via
 * `Promise.allSettled` so a single transient failure doesn't tank the rest.
 */
export async function markEnqueueDeferredManyFallback<Input, Output>(
  jobStore: IJobStore<Input, Output>,
  ids: readonly MessageId[],
  opts: { readonly visible_at: Date; readonly errorCode: string }
): Promise<{ failed: readonly { id: MessageId; err: unknown }[] }> {
  const results = await Promise.allSettled(ids.map((id) => jobStore.markEnqueueDeferred(id, opts)));
  const failed = results.flatMap((r, i) =>
    r.status === "rejected" ? [{ id: ids[i]!, err: r.reason }] : []
  );
  return { failed };
}

/**
 * Module-level dedupe set for the non-durable-store pairing warning.
 * WeakSet so store instances aren't pinned in memory — the warning fires
 * once per process per store, then the store's lifecycle is unaffected.
 */
const warnedNonDurableStores = new WeakSet<object>();

/**
 * Warn (once per process per store) when a cloud message-queue adapter is
 * paired with a non-durable job store. Cloud transports are at-least-once
 * and cross-process: with a store whose rows do not survive the process,
 * partial-failure rows strand forever (no shared lease-expiry sweep across
 * processes). Keys on the declared {@link IJobStore.durable} flag, so the
 * check survives decorators and minified bundles — unlike a
 * constructor-name probe.
 */
export function warnIfNonDurableJobStore(jobStore: IJobStore<any, any>, adapterName: string): void {
  const store = jobStore as unknown as object;
  if (jobStore.durable === false && !warnedNonDurableStores.has(store)) {
    warnedNonDurableStores.add(store);
    getLogger().warn(
      `[${adapterName}] non-durable job store detected — cloud adapters require a durable, lease-sweeping JobStore (Postgres/Supabase/SQLite). Rows may strand on partial failures.`
    );
  }
}
