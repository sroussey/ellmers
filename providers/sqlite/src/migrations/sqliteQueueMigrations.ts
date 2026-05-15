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

/** Initial migration set for the SQLite queue table identified by `tableName`. */
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
            ${prefixColumnsSql}fingerprint text NOT NULL,
            queue text NOT NULL,
            job_run_id text NOT NULL,
            status TEXT NOT NULL default 'PENDING',
            input TEXT NOT NULL,
            output TEXT,
            attempts INTEGER default 0,
            max_attempts INTEGER default 10,
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
            lease_owner TEXT
          );

          CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, status, visible_at);
          CREATE INDEX IF NOT EXISTS job_queue_fingerprint${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, fingerprint, status);
          CREATE INDEX IF NOT EXISTS job_queue_job_run_id${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, job_run_id);
        `);
      },
    },
    {
      component,
      version: 2,
      description: "Add abort_requested_at and lease_expires_at columns",
      up(db: Sqlite.Database) {
        db.exec(`
          ALTER TABLE ${tableName} ADD COLUMN abort_requested_at TEXT;
          ALTER TABLE ${tableName} ADD COLUMN lease_expires_at TEXT;
        `);
      },
    },
    {
      component,
      version: 3,
      description:
        "Rename columns: run_after→visible_at, last_ran_at→last_attempted_at, run_attempts→attempts, max_retries→max_attempts, worker_id→lease_owner",
      up(db: Sqlite.Database) {
        // Only rename if the old column names still exist (skip on fresh installs)
        const cols: string[] = db
          .prepare<[], { name: string }>(`PRAGMA table_info(${tableName})`)
          .all()
          .map((r) => r.name);
        const renames: [string, string][] = [
          ["run_after", "visible_at"],
          ["last_ran_at", "last_attempted_at"],
          ["run_attempts", "attempts"],
          ["max_retries", "max_attempts"],
          ["worker_id", "lease_owner"],
        ];
        for (const [oldName, newName] of renames) {
          if (cols.includes(oldName)) {
            db.exec(`ALTER TABLE ${tableName} RENAME COLUMN ${oldName} TO ${newName};`);
          }
        }
      },
    },
  ];
}
