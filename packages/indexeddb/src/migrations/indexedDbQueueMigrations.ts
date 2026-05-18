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
 * v1 is FROZEN byte-for-byte against the pre-PR shape (097b4afa) — it
 * creates the `queue_status_run_after` compound index and reads `run_after`
 * from each row. The rename to `queue_status_visible_at` lives in v2,
 * which also walks every existing row and copies `run_after → visible_at`
 * synchronously inside the upgrade transaction.
 *
 * Schema (post v2): a single object store keyed by `id` plus four compound
 * indexes (queue/status, queue/status/visible_at, queue/job_run_id,
 * queue/fingerprint/status). When `prefixes` is non-empty the prefix
 * columns are prepended to every index key path so per-tenant queries can
 * be served directly by the index.
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
    {
      component,
      version: 2,
      description:
        "Rename queue_status_run_after → queue_status_visible_at; backfill run_after → visible_at",
      up({ tx }) {
        // IDB upgrade transactions auto-commit as soon as `up()` returns —
        // we MUST NOT `await` anything between IDB operations. All cursor
        // and index work below uses synchronous request callbacks fired by
        // the same upgrade tx, which is the only legal pattern.
        const store = tx.objectStore(tableName);

        // Drop the old index BEFORE rewriting rows so the cursor walk does
        // not have to maintain its key. IDB doesn't allow renaming an index
        // in place; the only path is delete + create.
        const indexNames = Array.from(store.indexNames);
        if (indexNames.includes("queue_status_run_after")) {
          store.deleteIndex("queue_status_run_after");
        }

        // Walk every row and copy `run_after` → `visible_at`. `openCursor()`
        // returns a request whose `onsuccess` fires once per row plus a
        // final time with `cursor === null`; the upgrade tx stays open as
        // long as new requests are issued from the current callback.
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const row = cursor.value as Record<string, unknown> | null;
          if (row && row.visible_at === undefined && row.run_after !== undefined) {
            row.visible_at = row.run_after;
            cursor.update(row);
          }
          cursor.continue();
        };

        // Recreate the index under the new name keyed on `visible_at`.
        // Skip if a previous partial run already created it (defensive — IDB
        // forbids two indexes sharing a name and would throw mid-upgrade).
        if (!Array.from(store.indexNames).includes("queue_status_visible_at")) {
          store.createIndex("queue_status_visible_at", k(["queue", "status", "visible_at"]), {
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
