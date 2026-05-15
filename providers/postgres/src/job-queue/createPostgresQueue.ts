/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QueueStorageOptions } from "@workglow/job-queue";
import type { Pool } from "@workglow/postgres/storage";
import { PostgresJobStore } from "./PostgresJobStore";
import { PostgresMessageQueue, type PendingWrite } from "./PostgresMessageQueue";
import { PostgresQueueStorage } from "./PostgresQueueStorage";

/**
 * Factory for the paired Postgres message queue and job store. Both
 * facades share a single underlying {@link PostgresQueueStorage} so writes
 * through one are observable through the other.
 */
export function createPostgresQueue<Input, Output>(
  queueName: string,
  pool: Pool,
  opts?: QueueStorageOptions
): {
  messageQueue: PostgresMessageQueue<Input, Output>;
  jobStore: PostgresJobStore<Input, Output>;
  /** @internal — exposed for callers that still need the legacy storage object. */
  core: PostgresQueueStorage<Input, Output>;
} {
  const core = new PostgresQueueStorage<Input, Output>(pool, queueName, opts);
  const pending = new Map<unknown, PendingWrite<Output>>();
  return {
    messageQueue: new PostgresMessageQueue<Input, Output>(core, pending),
    jobStore: new PostgresJobStore<Input, Output>(core, pending),
    core,
  };
}
