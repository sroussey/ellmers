/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PrefixColumn } from "@workglow/job-queue";
import type { IndexedDbMigration, IndexedDbMigrationGroup } from "./IndexedDbMigrationRunner";

/**
 * Initial migration set for the IndexedDB queue object store identified by
 * `tableName`.
 *
 * Component name is `queue:indexeddb:<tableName>` so two queues with
 * different table names get tracked independently in `_storage_migrations`.
 *
 * Schema: a single object store keyed by `id` plus four compound indexes
 * (queue/status, queue/status/run_after, queue/job_run_id,
 * queue/fingerprint/status). When `prefixes` is non-empty the prefix columns
 * are prepended to every index key path so per-tenant queries can be served
 * directly by the index.
 */
export function indexedDbQueueMigrations(
  tableName: string,
  prefixes: readonly PrefixColumn[]
): IndexedDbMigration[] {
  const component = `queue:indexeddb:${tableName}`;
  const prefixCols = prefixes.map((p) => p.name);
  const k = (cols: string[]): string[] => [...prefixCols, ...cols];

  return [
    {
      component,
      version: 1,
      description: "Create queue object store + indexes",
      up({ db }) {
        if (!db.objectStoreNames.contains(tableName)) {
          const store = db.createObjectStore(tableName, { keyPath: "id" });
          store.createIndex("queue_status", k(["queue", "status"]), { unique: false });
          store.createIndex("queue_status_run_after", k(["queue", "status", "run_after"]), {
            unique: false,
          });
          store.createIndex("queue_job_run_id", k(["queue", "job_run_id"]), { unique: false });
          store.createIndex("queue_fingerprint_status", k(["queue", "fingerprint", "status"]), {
            unique: false,
          });
        }
      },
    },
  ];
}

/** Returns the queue migrations packaged with their target IDB database name. */
export function indexedDbQueueMigrationGroup(
  tableName: string,
  prefixes: readonly PrefixColumn[]
): IndexedDbMigrationGroup {
  return {
    dbName: tableName,
    migrations: indexedDbQueueMigrations(tableName, prefixes),
  };
}
