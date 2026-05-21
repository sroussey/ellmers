/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  JobStatus,
  type ClaimFailOptions,
  type IClaim,
  type IJobStore,
  type JobRecord,
  type JobStorageFormat,
  type MessageId,
} from "@workglow/job-queue";
import type { CloudMessageBody } from "./types";

export interface CloudflareClaimOptions<Input, Output> {
  readonly message: Message<CloudMessageBody>;
  readonly jobStore: IJobStore<Input, Output>;
  readonly record: JobRecord<Input, Output>;
}

/**
 * Adapts a Cloudflare Queues `Message` to the `IClaim` contract.
 *
 * `ack` / `fail` settle the message AND atomically persist the result/error
 * via the new `IJobStore.completeWithResult` / `failWithError` helpers.
 * `extendLease` is unsupported — Cloudflare Queues have a fixed visibility
 * window with no extension API.
 */
export class CloudflareClaim<Input, Output> implements IClaim<JobStorageFormat<Input, Output>> {
  public readonly id: MessageId;
  public readonly body: JobStorageFormat<Input, Output>;
  public readonly attempts: number;

  private readonly message: Message<CloudMessageBody>;
  private readonly jobStore: IJobStore<Input, Output>;

  constructor(opts: CloudflareClaimOptions<Input, Output>) {
    this.message = opts.message;
    this.jobStore = opts.jobStore;
    this.id = opts.record.id as MessageId;
    this.body = opts.record;
    this.attempts = opts.record.attempts ?? 0;
  }

  // Ordering note (ack/fail): message.ack() runs before the JobStore write.
  // If the store write throws, CFQ will not redeliver — the row stays
  // PROCESSING and the worker's lease-expiry path eventually reconciles it.
  // Reversing the order would risk double-delivery, which is worse.
  // CloudflareClaim.fail() also calls message.ack() (NOT message.retry()):
  // terminal failures must not be redelivered by CFQ; the worker decides
  // retry policy via attempts/max_attempts.
  async ack(result?: unknown): Promise<void> {
    this.message.ack();
    if (result !== undefined) {
      await this.jobStore.completeWithResult(this.id, result as Output);
    } else {
      await this.jobStore.saveStatus(this.id, JobStatus.COMPLETED);
    }
  }

  async fail(opts?: ClaimFailOptions): Promise<void> {
    this.message.ack();
    await this.jobStore.failWithError(this.id, {
      error: opts?.error,
      errorCode: opts?.errorCode,
      abortRequested: opts?.abortRequested,
    });
  }

  async retry(opts?: { delaySeconds?: number }): Promise<void> {
    this.message.retry(opts);
  }

  async extendLease(_ms: number): Promise<void> {
    throw new Error(
      "extendLease not supported by Cloudflare Queues — run with extendLeaseWhileRunning: false and size jobs to fit within the 30s visibility window"
    );
  }

  async disable(): Promise<void> {
    // Persist the DISABLED terminal state FIRST, ack the queue message after.
    // If ack races a redelivery, `handleQueueBatch` drops terminal-status
    // redeliveries — so a redundant redelivery is filtered. The reverse order
    // would lose the disable on a transient store error: the message would
    // be acked + gone, but the row stuck in PROCESSING with no retry path.
    await this.jobStore.markDisabled(this.id);
    this.message.ack();
  }
}
