/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QueuePair, QueueStorageOptions } from "@workglow/job-queue";
import { wrapQueueStorage } from "@workglow/job-queue";
import type { Pool } from "@workglow/postgres/storage";
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
): QueuePair<Input, Output> {
  return wrapQueueStorage<Input, Output>(
    new PostgresQueueStorage<Input, Output>(pool, queueName, opts)
  );
}
