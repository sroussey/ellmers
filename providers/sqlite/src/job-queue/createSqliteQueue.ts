/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Sqlite } from "@workglow/sqlite/storage";
import { SqliteJobStore } from "./SqliteJobStore";
import { SqliteMessageQueue, type PendingWrite } from "./SqliteMessageQueue";
import { SqliteQueueStorage, type SqliteQueueStorageOptions } from "./SqliteQueueStorage";

/**
 * Factory for the paired SQLite message queue and job store. Both facades
 * share a single underlying {@link SqliteQueueStorage} so writes through one
 * are observable through the other.
 */
export function createSqliteQueue<Input, Output>(
  queueName: string,
  db: Sqlite.Database,
  opts?: SqliteQueueStorageOptions
): {
  messageQueue: SqliteMessageQueue<Input, Output>;
  jobStore: SqliteJobStore<Input, Output>;
  /** @internal — exposed for callers that still need the legacy storage object. */
  core: SqliteQueueStorage<Input, Output>;
} {
  const core = new SqliteQueueStorage<Input, Output>(db, queueName, opts);
  const pending = new Map<unknown, PendingWrite<Output>>();
  return {
    messageQueue: new SqliteMessageQueue<Input, Output>(core, pending),
    jobStore: new SqliteJobStore<Input, Output>(core, pending),
    core,
  };
}
