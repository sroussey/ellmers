/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Sqlite } from "@workglow/sqlite/storage";
import type { PrefixColumn } from "@workglow/job-queue";
import {
  buildPrefixColumnsSql,
  getPrefixIndexPrefix,
  getPrefixIndexSuffix,
  type IMigration,
  SqliteDialect,
} from "@workglow/storage";

/** Initial migration set for the SQLite rate-limiter tables. */
export function sqliteRateLimiterMigrations(
  executionTableName: string,
  nextAvailableTableName: string,
  prefixes: readonly PrefixColumn[]
): IMigration<Sqlite.Database>[] {
  const component = `rate-limiter:sqlite:${executionTableName}`;
  const prefixColumnsSql = buildPrefixColumnsSql(SqliteDialect, prefixes);
  const prefixIndexPrefix = getPrefixIndexPrefix(prefixes);
  const indexSuffix = getPrefixIndexSuffix(prefixes);

  return [
    {
      component,
      version: 1,
      description: "Create rate-limiter execution + next_available tables",
      up(db: Sqlite.Database) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS ${executionTableName} (
            id INTEGER PRIMARY KEY,
            ${prefixColumnsSql}queue_name TEXT NOT NULL,
            executed_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS rate_limit_exec_queue${indexSuffix}_idx
            ON ${executionTableName} (${prefixIndexPrefix}queue_name, executed_at);
        `);
        db.exec(`
          CREATE TABLE IF NOT EXISTS ${nextAvailableTableName} (
            ${prefixColumnsSql}queue_name TEXT PRIMARY KEY,
            next_available_at TEXT
          );
        `);
      },
    },
  ];
}
