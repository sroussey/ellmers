/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IClaim,
  type IJobStore,
  type IMessageQueue,
  type JobStorageFormat,
  type MessageId,
  type QueueStorageScope,
  type SendOptions,
} from "@workglow/job-queue";
import { getLogger } from "@workglow/util";
import type { CloudMessageBody, CloudflareQueueOptions } from "./types";

const CF_MAX_DELAY_SECONDS = 12 * 60 * 60;
/**
 * Backoff applied to `visible_at` when an enqueue throws transiently. Keeps
 * the row PENDING so a subsequent producer retry / poll picks it up again
 * instead of marking it FAILED on the first network blip. See H4.
 */
const ENQUEUE_DEFER_BACKOFF_MS = 30_000;

/**
 * H5: clamp the defer interval to the original `delaySeconds` floor so a row
 * with a legitimate large delay (e.g. 1h scheduled work) is NOT pulled
 * forward to now + 30s by a producer-side blip. Returns the maximum of the
 * original delay and the producer-retry backoff so:
 *   - delaySeconds = 0   → wait 30s before next producer attempt
 *   - delaySeconds = 3600 → wait 3600s (the original schedule)
 *
 * TODO: full exponential backoff requires a new enqueue_defer_attempts field;
 * see follow-up issue. Today's mitigation just prevents the bug where a
 * scheduled row is silently re-delivered ahead of schedule.
 */
function computeDeferDelayMs(originalDelaySeconds: number | undefined): number {
  const original = originalDelaySeconds != null ? originalDelaySeconds * 1000 : 0;
  return Math.max(original, ENQUEUE_DEFER_BACKOFF_MS);
}

/**
 * Fallback used when the underlying `IJobStore` does not implement the
 * optional `markEnqueueDeferredMany` (bare InMemoryJobStore, etc.). Mirrors
 * the WrappedJobStore default impl: parallel per-id writes via
 * `Promise.allSettled` so a single transient failure doesn't tank the rest.
 */
async function markEnqueueDeferredManyFallback<Input, Output>(
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
 * Module-level dedupe set for the InMemoryJobStore-pairing warning (H3).
 * WeakSet so we don't pin store instances in memory — the warning fires
 * once per process per store, then the store's lifecycle is unaffected.
 */
const __warnedInMemoryStores = new WeakSet<object>();

/**
 * `IMessageQueue` adapter backed by a Cloudflare Queues producer binding.
 *
 * Cloudflare Queues are push-only: messages are delivered to your Worker's
 * `queue()` handler rather than pulled. Consequently `receive()` throws —
 * use `handleQueueBatch(batch, worker, jobStore)` from inside the Worker's
 * queue handler instead.
 */
export class CloudflareMessageQueue<Input, Output> implements IMessageQueue<
  JobStorageFormat<Input, Output>
> {
  public readonly scope: QueueStorageScope = "cluster";

  private readonly queue: Queue<CloudMessageBody>;
  private readonly queueName: string;
  private readonly jobStore: IJobStore<Input, Output>;

  constructor(opts: CloudflareQueueOptions<Input, Output>) {
    this.queue = opts.queue;
    this.queueName = opts.queueName;
    this.jobStore = opts.jobStore;

    // H3: warn loudly (once per store) when paired with InMemoryJobStore.
    // CFQ delivers to a Worker invocation — across invocations, an in-memory
    // store loses partial-failure rows entirely.
    const storeCtor = (opts.jobStore as unknown as { constructor?: { name?: string } })
      ?.constructor;
    if (
      storeCtor?.name === "InMemoryJobStore" &&
      !__warnedInMemoryStores.has(opts.jobStore as unknown as object)
    ) {
      __warnedInMemoryStores.add(opts.jobStore as unknown as object);
      getLogger().warn(
        "[CloudflareMessageQueue] InMemoryJobStore detected — cloud adapters require a lease-sweeping JobStore (Postgres/Supabase/SQLite). Rows may strand on partial failures."
      );
    }
  }

  async send(body: JobStorageFormat<Input, Output>, opts: SendOptions = {}): Promise<MessageId> {
    if (opts.delaySeconds != null && opts.delaySeconds > CF_MAX_DELAY_SECONDS) {
      throw new RangeError(
        `Cloudflare Queues send delaySeconds=${opts.delaySeconds} exceeds the 12h maximum (${CF_MAX_DELAY_SECONDS}s)`
      );
    }
    if (opts.fingerprint) {
      const existing = await this.jobStore.findActiveByFingerprint(
        opts.fingerprint,
        this.queueName
      );
      if (existing?.id != null) return existing.id as MessageId;
    }

    const id = await this.jobStore.create(body, opts);
    const envelope: CloudMessageBody = {
      id: String(id),
      attempts: 0,
      deadlineAt: opts.timeoutSeconds != null ? Date.now() + opts.timeoutSeconds * 1000 : undefined,
    };
    try {
      await this.queue.send(
        envelope,
        opts.delaySeconds ? { delaySeconds: opts.delaySeconds } : undefined
      );
      return id;
    } catch (err) {
      // H4: a producer-side throw is transient — leave the row PENDING so a
      // retry or a polling consumer can pick it back up. We shift visible_at
      // forward and stamp error_code; status/attempts are untouched.
      // H5: clamp to the original delaySeconds floor so a scheduled row is
      // not pulled forward by the producer-retry backoff.
      await this.jobStore.markEnqueueDeferred(id, {
        visible_at: new Date(Date.now() + computeDeferDelayMs(opts.delaySeconds)),
        errorCode: "ENQUEUE_FAILED",
      });
      throw err;
    }
  }

  async sendBatch(
    bodies: readonly JobStorageFormat<Input, Output>[],
    opts: SendOptions = {}
  ): Promise<readonly MessageId[]> {
    // H3: applying a single fingerprint to a whole batch is almost always a
    // bug — every body would dedup against the first row, returning the same
    // id for distinct payloads. Force callers that want fingerprint-based
    // dedup to use per-body send() instead.
    if (opts.fingerprint != null) {
      throw new RangeError(
        "sendBatch does not accept a single fingerprint applied to all bodies; use send() per body for fingerprinted dedup"
      );
    }
    // H6: mirror the send() check before the jobStore.create loop. Without
    // this, an over-limit delaySeconds would create N PENDING rows and only
    // fail at the queue.sendBatch boundary — leaving the rows stranded via
    // the H4 defer path even though the call was structurally invalid.
    if (opts.delaySeconds != null && opts.delaySeconds > CF_MAX_DELAY_SECONDS) {
      throw new RangeError(
        `Cloudflare Queues sendBatch delaySeconds=${opts.delaySeconds} exceeds the 12h maximum (${CF_MAX_DELAY_SECONDS}s)`
      );
    }
    const ids: MessageId[] = [];
    for (const body of bodies) {
      const resolved = await this.jobStore.create(body, opts);
      ids.push(resolved);
    }

    const messages: MessageSendRequest<CloudMessageBody>[] = ids.map((id) => ({
      body: { id: String(id), attempts: 0 },
      ...(opts.delaySeconds ? { delaySeconds: opts.delaySeconds } : {}),
    }));

    try {
      await this.queue.sendBatch(messages);
    } catch (err) {
      // H4: transient — keep every row PENDING with visible_at pushed forward
      // and error_code set. Re-throw so the caller sees the failure. Prefer
      // the batched many-variant when the IJobStore exposes it (WrappedJobStore
      // ships a Promise.allSettled default; native SQL backends can override
      // with a single bulk UPDATE). Fall back to a per-id allSettled fan-out
      // for bare IJobStore impls (e.g. InMemoryJobStore in tests) that don't
      // implement the optional method.
      // H5: clamp to the original delaySeconds floor.
      const defer = new Date(Date.now() + computeDeferDelayMs(opts.delaySeconds));
      const deferOpts = { visible_at: defer, errorCode: "ENQUEUE_FAILED" };
      const deferResult = this.jobStore.markEnqueueDeferredMany
        ? await this.jobStore.markEnqueueDeferredMany(ids, deferOpts)
        : await markEnqueueDeferredManyFallback(this.jobStore, ids, deferOpts);
      for (const { id, err: deferErr } of deferResult.failed) {
        getLogger().error(`[CloudflareMessageQueue] markEnqueueDeferred failed id=${String(id)}`, {
          err: deferErr,
        });
      }
      throw err;
    }
    return ids;
  }

  async receive(_opts?: {
    workerId: string;
    leaseMs: number;
    max?: number;
  }): Promise<readonly IClaim<JobStorageFormat<Input, Output>>[]> {
    throw new Error(
      "CloudflareMessageQueue.receive() is not supported — Cloudflare Queues are push-only. Drive processing from your Worker's queue() handler via handleQueueBatch()."
    );
  }

  async releaseClaim(_id: MessageId): Promise<void> {
    // Best-effort no-op. The CF runtime redelivers unacked messages after the visibility window.
  }

  async migrate(): Promise<void> {
    // No schema to migrate.
  }

  getMigrations(): ReadonlyArray<unknown> {
    return [];
  }
}
