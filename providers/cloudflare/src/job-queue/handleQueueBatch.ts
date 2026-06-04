/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IClaim,
  type IJobStore,
  JobStatus,
  type JobStorageFormat,
  type MessageId,
} from "@workglow/job-queue";
import { getLogger } from "@workglow/util";
import { CloudflareClaim } from "./CloudflareClaim";
import type { CloudMessageBody } from "./types";

/** Subset of `JobQueueWorker` we depend on — kept minimal for testability. */
export interface QueueBatchWorker<Input, Output> {
  processClaims(claims: readonly IClaim<JobStorageFormat<Input, Output>>[]): Promise<void>;
}

/**
 * Drive `JobQueueWorker.processClaims` from a Cloudflare Worker's
 * `queue(batch, env, ctx)` handler.
 *
 * Steps:
 *   1. Extract each message's envelope `id`.
 *   2. Batch-fetch the corresponding job records via `IJobStore.getMany`.
 *   3. For each record present, wrap the message in a `CloudflareClaim`.
 *   4. For each missing record (orphan), `message.ack()` and skip with a warning.
 *   5. Await `worker.processClaims(claims)` to settle the present ones.
 */
export async function handleQueueBatch<Input, Output>(
  batch: MessageBatch<CloudMessageBody>,
  worker: QueueBatchWorker<Input, Output>,
  jobStore: IJobStore<Input, Output>
): Promise<void> {
  const messages = batch.messages;
  if (messages.length === 0) return;

  const ids = messages.map((m) => m.body.id) as readonly MessageId[];
  const records = await jobStore.getMany(ids);

  const claims: CloudflareClaim<Input, Output>[] = [];
  for (let i = 0; i < messages.length; i++) {
    const record = records[i];
    const message = messages[i];
    if (!record) {
      message.ack();
      getLogger().warn(
        `[handleQueueBatch] orphan message id=${message.body.id} acked (no JobStore record found)`
      );
      continue;
    }
    // Cloudflare Queues is at-least-once, so a row that's already in a
    // terminal status (the original handler ran and ack'd, but the runtime
    // chose to redeliver anyway because of an at-least-once edge case or a
    // delayed ack visibility issue) must not flow into the worker — if it
    // did, validateJobState would throw PermanentJobError, the non-retryable
    // branch would route to failJob → claim.fail → failWithError, overwriting
    // the terminal status. ack and skip at the dispatch boundary instead.
    if (
      record.status === JobStatus.COMPLETED ||
      record.status === JobStatus.FAILED ||
      record.status === JobStatus.DISABLED
    ) {
      message.ack();
      getLogger().warn(
        `[handleQueueBatch] dropping terminal-status redelivery id=${message.body.id} status=${record.status}`
      );
      continue;
    }
    claims.push(new CloudflareClaim<Input, Output>({ message, jobStore, record }));
  }

  if (claims.length > 0) {
    await worker.processClaims(claims);
  }
}
