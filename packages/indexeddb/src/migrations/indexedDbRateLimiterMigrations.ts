/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PrefixColumn } from "@workglow/job-queue";
import type { IndexedDbMigration, IndexedDbMigrationGroup } from "./IndexedDbMigrationRunner";

/**
 * Initial migrations for the IndexedDB rate-limiter execution table.
 *
 * Schema: an object store keyed by `id` (autoincrement-style; we generate
 * UUIDs at the storage layer) plus a compound index `queue_executed_at` for
 * windowed counts. Prefix columns are prepended to every index key path.
 */
export function indexedDbRateLimiterExecutionMigrations(
  executionTableName: string,
  prefixes: readonly PrefixColumn[]
): IndexedDbMigration[] {
  const component = `rate-limiter:indexeddb:${executionTableName}`;
  const prefixCols = prefixes.map((p) => p.name);
  const k = (cols: string[]): string[] => [...prefixCols, ...cols];

  return [
    {
      component,
      version: 1,
      description: "Create rate-limiter execution object store + indexes",
      up({ db }) {
        if (!db.objectStoreNames.contains(executionTableName)) {
          const store = db.createObjectStore(executionTableName, { keyPath: "id" });
          store.createIndex("queue_executed_at", k(["queue_name", "executed_at"]), {
            unique: false,
          });
        }
      },
    },
  ];
}

/**
 * Initial migrations for the IndexedDB rate-limiter `next_available` table.
 *
 * Schema: object store keyed by a single synthetic field whose name is
 * `prefixCols.concat(["queue_name"]).join("_")`. The storage layer writes
 * a record where this field holds `prefixValues.concat([queueName]).join("_")`
 * — i.e. tenant-qualified — so the same physical store can hold rows for
 * multiple tenants without collisions. Without this, two tenants with the
 * same queue name would silently overwrite each other's row (the
 * `next_available_at` of one would be returned for the other).
 *
 * No `queue_name = "myqueue"` index is created because the storage's read
 * path (`store.get(syntheticKey)`) goes through the primary key directly.
 */
export function indexedDbRateLimiterNextAvailableMigrations(
  nextAvailableTableName: string,
  prefixes: readonly PrefixColumn[]
): IndexedDbMigration[] {
  const component = `rate-limiter:indexeddb:${nextAvailableTableName}`;
  const prefixCols = prefixes.map((p) => p.name);
  // The keyPath is a single field whose name encodes the prefix-qualified
  // identifier. With no prefixes this collapses to `"queue_name"`, matching
  // the legacy single-tenant layout.
  const keyField = [...prefixCols, "queue_name"].join("_");

  return [
    {
      component,
      version: 1,
      description: "Create rate-limiter next_available object store",
      up({ db }) {
        if (!db.objectStoreNames.contains(nextAvailableTableName)) {
          db.createObjectStore(nextAvailableTableName, { keyPath: keyField });
        }
      },
    },
  ];
}

/**
 * Returns the rate-limiter migrations packaged as IDB migration groups —
 * one group per database, since `IndexedDbRateLimiterStorage` keeps the
 * execution and next-available tables in separate databases.
 */
export function indexedDbRateLimiterMigrationGroups(
  executionTableName: string,
  nextAvailableTableName: string,
  prefixes: readonly PrefixColumn[]
): IndexedDbMigrationGroup[] {
  return [
    {
      dbName: executionTableName,
      migrations: indexedDbRateLimiterExecutionMigrations(executionTableName, prefixes),
    },
    {
      dbName: nextAvailableTableName,
      migrations: indexedDbRateLimiterNextAvailableMigrations(nextAvailableTableName, prefixes),
    },
  ];
}
