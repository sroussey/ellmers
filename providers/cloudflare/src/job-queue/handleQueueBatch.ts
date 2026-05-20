/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IClaim, IJobStore, JobStorageFormat, MessageId } from "@workglow/job-queue";
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
      // eslint-disable-next-line no-console
      console.warn(
        `[handleQueueBatch] orphan message id=${message.body.id} acked (no JobStore record found)`
      );
      continue;
    }
    claims.push(new CloudflareClaim<Input, Output>({ message, jobStore, record }));
  }

  if (claims.length > 0) {
    await worker.processClaims(claims);
  }
}
