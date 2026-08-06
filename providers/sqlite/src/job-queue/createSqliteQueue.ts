/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QueuePair } from "@workglow/job-queue";
import { wrapQueueStorage } from "@workglow/job-queue";
import type { Sqlite } from "@workglow/sqlite/storage";
import { SqliteQueueStorage, type SqliteQueueStorageOptions } from "./SqliteQueueStorage";

/**
 * Factory for the paired SQLite message queue and job store. Both
 * facades share a single underlying {@link SqliteQueueStorage} so writes
 * through one are observable through the other.
 */
export function createSqliteQueue<Input, Output>(
  queueName: string,
  db: Sqlite.Database,
  opts?: SqliteQueueStorageOptions
): QueuePair<Input, Output> {
  return wrapQueueStorage<Input, Output>(
    new SqliteQueueStorage<Input, Output>(db, queueName, opts)
  );
}
