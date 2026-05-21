/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PrefixColumn } from "@workglow/job-queue";
import type { Sqlite } from "@workglow/sqlite/storage";
import {
  buildPrefixColumnsSql,
  getPrefixIndexPrefix,
  getPrefixIndexSuffix,
  type IMigration,
  SqliteDialect,
} from "@workglow/storage";

export function buildSqliteQueueColumnSql(prefixColumnsSql: string): string {
  // buildPrefixColumnsSql(...) returns either "" or an already-indented,
  // comma-terminated prefix block, so it is safe to splice directly into
  // the canonical column list here.
  return `${prefixColumnsSql}fingerprint TEXT NOT NULL,
            queue TEXT NOT NULL,
            job_run_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            input TEXT NOT NULL,
            output TEXT,
            attempts INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 10,
            visible_at TEXT NOT NULL,
            last_attempted_at TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            deadline_at TEXT,
            error TEXT,
            error_code TEXT,
            progress REAL DEFAULT 0,
            progress_message TEXT DEFAULT '',
            progress_details TEXT NULL,
            lease_owner TEXT,
            abort_requested_at TEXT,
            lease_expires_at TEXT`;
}

/**
 * Migration set for the SQLite queue table identified by `tableName`.
 *
 * v1 creates the canonical schema plus a UNIQUE partial fingerprint index
 * used for O(1) fingerprint dedup at the DB layer.
 */
export function sqliteQueueMigrations(
  tableName: string,
  prefixes: readonly PrefixColumn[]
): IMigration<Sqlite.Database>[] {
  const component = `queue:sqlite:${tableName}`;
  const prefixColumnsSql = buildPrefixColumnsSql(SqliteDialect, prefixes);
  const prefixIndexPrefix = getPrefixIndexPrefix(prefixes);
  const indexSuffix = getPrefixIndexSuffix(prefixes);

  return [
    {
      component,
      version: 1,
      description: "Create queue table + indexes",
      up(db: Sqlite.Database) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS ${tableName} (
            id INTEGER PRIMARY KEY,
            ${buildSqliteQueueColumnSql(prefixColumnsSql)}
          );

          CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, status, visible_at);
          CREATE INDEX IF NOT EXISTS job_queue_fingerprint${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, fingerprint, status);
          CREATE INDEX IF NOT EXISTS job_queue_job_run_id${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, job_run_id);

          CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_fingerprint_active
            ON ${tableName}(${prefixIndexPrefix}queue, fingerprint)
            WHERE status IN ('PENDING','PROCESSING');
        `);
      },
    },
  ];
}
