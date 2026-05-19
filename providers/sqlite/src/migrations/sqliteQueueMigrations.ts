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

/**
 * Initial migration set for the SQLite queue table identified by `tableName`.
 *
 * v1 is FROZEN byte-for-byte against the pre-PR shape — it creates the
 * `run_after`/`run_attempts`/`max_retries`/`last_ran_at`/`worker_id`
 * columns and the `run_after`-keyed index. Renames and the index swap
 * live in v3, guarded by `PRAGMA table_info` lookups so fresh installs
 * (which still run v1 → v2 → v3) end up at the same final schema as
 * already-migrated DBs.
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
            ${prefixColumnsSql}fingerprint text NOT NULL,
            queue text NOT NULL,
            job_run_id text NOT NULL,
            status TEXT NOT NULL default 'PENDING',
            input TEXT NOT NULL,
            output TEXT,
            run_attempts INTEGER default 0,
            max_retries INTEGER default 23,
            run_after TEXT NOT NULL,
            last_ran_at TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            deadline_at TEXT,
            error TEXT,
            error_code TEXT,
            progress REAL DEFAULT 0,
            progress_message TEXT DEFAULT '',
            progress_details TEXT NULL,
            worker_id TEXT
          );

          CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, status, run_after);
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
        "Rename run_after→visible_at, last_ran_at→last_attempted_at, run_attempts→attempts, max_retries→max_attempts, worker_id→lease_owner; drop run_after-keyed index and recreate visible_at-keyed; lower max_attempts DEFAULT 23→10 to match Postgres parity",
      up(db: Sqlite.Database) {
        // PRAGMA table_info guards each rename so fresh installs (which
        // arrive at v3 having just created the v1 schema in this same
        // migration run) are no-ops here.
        type ColInfo = {
          readonly name: string;
          readonly type: string;
          readonly notnull: number;
          readonly dflt_value: string | null;
          readonly pk: number;
        };
        const colInfos: ColInfo[] = db
          .prepare<[], ColInfo>(`PRAGMA table_info(${tableName})`)
          .all();
        const cols: string[] = colInfos.map((r) => r.name);
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

        // SQLite carries indexes across RENAME COLUMN transparently, but the
        // index name still encodes the old column intent. Drop the v1
        // run_after-keyed index and recreate it keyed on visible_at so the
        // schema is self-describing. `IF EXISTS` covers fresh installs too.
        db.exec(`
          DROP INDEX IF EXISTS job_queue_fetcher${indexSuffix}_idx;
          CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, status, visible_at);
        `);

        // Postgres v3 explicitly applied `ALTER COLUMN max_attempts SET
        // DEFAULT 10`; SQLite has no `ALTER COLUMN ... SET DEFAULT` syntax,
        // so the original v3 migration left the SQLite default at 23 from
        // v1's CREATE TABLE. Fresh SQLite installs ended up at default 23
        // while Postgres was 10 — callers omitting `maxAttempts` got
        // divergent retry behavior across backends. Rebuild the table with
        // the correct default using SQLite's documented 12-step procedure
        // (https://www.sqlite.org/lang_altertable.html#otheralter).
        const postRenameInfos: ColInfo[] = db
          .prepare<[], ColInfo>(`PRAGMA table_info(${tableName})`)
          .all();
        const maxAttemptsCol = postRenameInfos.find((c) => c.name === "max_attempts");
        if (maxAttemptsCol && maxAttemptsCol.dflt_value !== "10") {
          // Build a new CREATE TABLE statement from the post-rename
          // table_info, swapping max_attempts's default. Preserving the
          // existing types / NOT NULL / PK / other defaults keeps the
          // rebuild a true no-op for every other column.
          const columnDefs = postRenameInfos
            .map((c) => {
              const parts: string[] = [c.name, c.type || ""];
              if (c.pk) {
                parts.push("PRIMARY KEY");
              }
              if (c.notnull) {
                parts.push("NOT NULL");
              }
              const dflt =
                c.name === "max_attempts" ? "10" : c.dflt_value !== null ? c.dflt_value : null;
              if (dflt !== null) {
                parts.push(`DEFAULT ${dflt}`);
              }
              return parts.filter((p) => p.length > 0).join(" ");
            })
            .join(",\n            ");
          const colList = postRenameInfos.map((c) => c.name).join(", ");
          const newTable = `${tableName}__new_v3`;
          db.exec(`
            CREATE TABLE ${newTable} (
              ${columnDefs}
            );
            INSERT INTO ${newTable} (${colList}) SELECT ${colList} FROM ${tableName};
            DROP TABLE ${tableName};
            ALTER TABLE ${newTable} RENAME TO ${tableName};

            CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, status, visible_at);
            CREATE INDEX IF NOT EXISTS job_queue_fingerprint${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, fingerprint, status);
            CREATE INDEX IF NOT EXISTS job_queue_job_run_id${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, job_run_id);
          `);
        }
      },
    },
  ];
}
