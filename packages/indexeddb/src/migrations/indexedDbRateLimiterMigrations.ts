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
 * Schema: object store keyed by `queue_name` (the natural primary key) plus a
 * compound index that includes prefix columns when present so per-tenant
 * lookups are still index-served.
 */
export function indexedDbRateLimiterNextAvailableMigrations(
  nextAvailableTableName: string,
  prefixes: readonly PrefixColumn[]
): IndexedDbMigration[] {
  const component = `rate-limiter:indexeddb:${nextAvailableTableName}`;
  const prefixCols = prefixes.map((p) => p.name);
  const k = (cols: string[]): string[] => [...prefixCols, ...cols];

  return [
    {
      component,
      version: 1,
      description: "Create rate-limiter next_available object store + index",
      up({ db }) {
        if (!db.objectStoreNames.contains(nextAvailableTableName)) {
          const store = db.createObjectStore(nextAvailableTableName, { keyPath: "queue_name" });
          store.createIndex("queue_name_idx", k(["queue_name"]), { unique: true });
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
