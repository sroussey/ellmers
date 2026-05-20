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
      await this.jobStore.failWithError(id, {
        error: err instanceof Error ? err.message : String(err),
        errorCode: "ENQUEUE_FAILED",
      });
      throw err;
    }
  }

  async sendBatch(
    bodies: readonly JobStorageFormat<Input, Output>[],
    opts: SendOptions = {}
  ): Promise<readonly MessageId[]> {
    const ids: MessageId[] = [];
    for (const body of bodies) {
      let resolved: MessageId | undefined;
      if (opts.fingerprint) {
        const existing = await this.jobStore.findActiveByFingerprint(
          opts.fingerprint,
          this.queueName
        );
        if (existing?.id != null) resolved = existing.id as MessageId;
      }
      if (resolved == null) resolved = await this.jobStore.create(body, opts);
      ids.push(resolved);
    }

    const messages: MessageSendRequest<CloudMessageBody>[] = ids.map((id) => ({
      body: { id: String(id), attempts: 0 },
      ...(opts.delaySeconds ? { delaySeconds: opts.delaySeconds } : {}),
    }));

    try {
      await this.queue.sendBatch(messages);
    } catch (err) {
      for (const id of ids) {
        await this.jobStore.failWithError(id, {
          error: err instanceof Error ? err.message : String(err),
          errorCode: "ENQUEUE_FAILED",
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
