/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  computeDeferDelayMs,
  markEnqueueDeferredManyFallback,
  warnIfNonDurableJobStore,
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

    // CFQ delivers to a Worker invocation — across invocations, a
    // non-durable store loses partial-failure rows entirely.
    warnIfNonDurableJobStore(opts.jobStore, "CloudflareMessageQueue");
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
      // A producer-side throw is transient — leave the row PENDING so a
      // retry or a polling consumer can pick it back up. We shift visible_at
      // forward and stamp error_code; status/attempts are untouched.
      // Clamp to the original delaySeconds floor so a scheduled row is
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
    // Applying a single fingerprint to a whole batch is almost always a
    // bug — every body would dedup against the first row, returning the same
    // id for distinct payloads. Force callers that want fingerprint-based
    // dedup to use per-body send() instead.
    if (opts.fingerprint != null) {
      throw new RangeError(
        "sendBatch does not accept a single fingerprint applied to all bodies; use send() per body for fingerprinted dedup"
      );
    }
    // Mirror the send() check before the jobStore.create loop. Without
    // this, an over-limit delaySeconds would create N PENDING rows and only
    // fail at the queue.sendBatch boundary — leaving the rows stranded via
    // the defer path even though the call was structurally invalid.
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
      // Transient — keep every row PENDING with visible_at pushed forward
      // and error_code set. Re-throw so the caller sees the failure. Prefer
      // the batched many-variant when the IJobStore exposes it (WrappedJobStore
      // ships a Promise.allSettled default; native SQL backends can override
      // with a single bulk UPDATE). Fall back to a per-id allSettled fan-out
      // for bare IJobStore impls (e.g. a bare custom store) that don't
      // implement the optional method. Clamp to the original delaySeconds floor.
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
