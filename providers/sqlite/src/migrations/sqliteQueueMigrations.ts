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

export function buildSqliteQueuePostV3ColumnSql(prefixColumnsSql: string): string {
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

export function buildSqliteQueuePostV3ColumnList(prefixes: readonly PrefixColumn[]): string {
  return `${prefixes.map((p) => p.name).join(", ")}${
    prefixes.length > 0 ? ", " : ""
  }fingerprint, queue, job_run_id, status, input, output, attempts, max_attempts, visible_at, last_attempted_at, created_at, completed_at, deadline_at, error, error_code, progress, progress_message, progress_details, lease_owner, abort_requested_at, lease_expires_at`;
}

export function buildSqliteQueuePostV3TableSql(
  tableName: string,
  prefixColumnsSql: string
): string {
  return `CREATE TABLE "${tableName}" (
        id INTEGER PRIMARY KEY,
        ${buildSqliteQueuePostV3ColumnSql(prefixColumnsSql)}
      )`;
}

/**
 * Rebuilds `tableName` from the canonical post-v3 CREATE TABLE so the
 * `max_attempts INTEGER DEFAULT 10` lands on disk. Idempotent: callers guard
 * with `tableSql.includes("max_attempts INTEGER DEFAULT 10")` (the only
 * already-converged shape) and skip if already correct.
 *
 * H3 safety wrap:
 *   - Capture the prior `PRAGMA foreign_keys` value so we restore it after.
 *   - Issue `PRAGMA foreign_keys = OFF;` for documentation purposes — this is
 *     a NO-OP inside an active transaction (sqlite ignores it), and the
 *     {@link SqliteMigrationRunner} wraps every `up()` in BEGIN/COMMIT. We
 *     therefore additionally run `PRAGMA foreign_key_check` post-rebuild to
 *     fail the migration if our copy left dangling references. The
 *     SQLite-documented 12-step procedure requires foreign_keys=OFF *outside*
 *     the txn, but our queue table has no inbound FKs in the canonical
 *     schema, so the failure mode is "user-defined FK to the queue table is
 *     left dangling" — captured by the post-check.
 *   - Snapshot triggers/views that reference `tableName` (sqlite drops them
 *     transparently when the table is dropped) and replay them after the
 *     rename so user-defined automation is preserved across the rebuild.
 */
function rebuildSqliteQueueTableForV4Default(
  db: Sqlite.Database,
  tableName: string,
  prefixColumnsSql: string,
  postV3ColumnList: string,
  prefixIndexPrefix: string,
  indexSuffix: string
): void {
  const fkPrev = db.prepare<[], { readonly foreign_keys: number }>("PRAGMA foreign_keys").get();

  // Documented no-op inside a txn — kept so a future caller that runs this
  // helper outside the migration runner's BEGIN/COMMIT gets the right
  // semantics. The post-check below is the real safety net.
  db.exec("PRAGMA foreign_keys = OFF;");

  try {
    // Snapshot user-defined triggers attached to this table; SQLite drops
    // them when we drop the original table, so we replay them after the
    // rename so a deployment's user-defined automation survives the rebuild.
    // Indexes are recreated explicitly below via CREATE INDEX so we skip
    // them here on purpose.
    //
    // VIEWS are intentionally NOT preserved here: in `sqlite_schema` a view's
    // `tbl_name` column is the VIEW's own name, not the table the view
    // references, so a `tbl_name = ?` filter cannot locate views that
    // reference the queue table. Parsing the view's `sql` to find dependent
    // tables is fragile (whitespace, quoting, aliases, subselects, CTEs) and
    // there are no in-tree consumers that rely on it. Operators with views
    // over the queue table must re-create them after this migration runs.
    type SchemaObj = {
      readonly type: string;
      readonly name: string;
      readonly sql: string | null;
    };
    const userTriggers: SchemaObj[] = db
      .prepare<
        [string],
        SchemaObj
      >("SELECT type, name, sql FROM sqlite_schema " + "WHERE type = 'trigger' AND tbl_name = ? " + "AND name NOT LIKE 'sqlite_%'")
      .all(tableName);

    const newTable = `${tableName}__new_v4`;
    db.exec(`
      ${buildSqliteQueuePostV3TableSql(newTable, prefixColumnsSql)};
      INSERT INTO ${newTable} (${postV3ColumnList}) SELECT ${postV3ColumnList} FROM ${tableName};
      DROP TABLE ${tableName};
      ALTER TABLE ${newTable} RENAME TO ${tableName};

      CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, status, visible_at);
      CREATE INDEX IF NOT EXISTS job_queue_fingerprint${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, fingerprint, status);
      CREATE INDEX IF NOT EXISTS job_queue_job_run_id${indexSuffix}_idx ON ${tableName} (${prefixIndexPrefix}queue, job_run_id);
    `);

    for (const trg of userTriggers) {
      if (trg.sql) {
        db.exec(`${trg.sql};`);
      }
    }

    // FK precheck: surface any user-defined FOREIGN KEY → queue-table
    // reference that our drop+rename left dangling. This catches the case
    // the PRAGMA-inside-txn limitation cannot prevent — fail loudly so the
    // migration rolls back rather than silently corrupting data.
    const violations = db
      .prepare<[], { readonly table: string; readonly rowid: number }>("PRAGMA foreign_key_check")
      .all();
    if (violations.length > 0) {
      throw new Error(`sqlite queue v4 rebuild left FK violations: ${JSON.stringify(violations)}`);
    }
  } finally {
    // Restore the caller's foreign_keys setting either way.
    db.exec(`PRAGMA foreign_keys = ${fkPrev?.foreign_keys ? "ON" : "OFF"};`);
  }
}

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
  const postV3ColumnList = buildSqliteQueuePostV3ColumnList(prefixes);

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
        type ColInfo = { readonly name: string };
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
        const tableSqlRow = db
          .prepare<
            [string],
            { readonly sql: string | null }
          >("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
          .get(tableName);
        if (tableSqlRow?.sql && !tableSqlRow.sql.includes("max_attempts INTEGER DEFAULT 10")) {
          // Rebuild from the canonical post-v3 CREATE TABLE statement instead
          // of reconstructing from PRAGMA table_info. table_info drops
          // metadata such as explicit NULL/COLLATE/CHECK clauses, so deriving
          // DDL from it would silently erase future schema details during this
          // rebuild step.
          //
          // Fresh installs land here on first migrate (the v1 CREATE TABLE
          // ran in the same migration call, so its `max_retries DEFAULT 23`
          // is still present until renamed). v4 below is a no-op for these
          // because this rebuild already converged them.
          rebuildSqliteQueueTableForV4Default(
            db,
            tableName,
            prefixColumnsSql,
            postV3ColumnList,
            prefixIndexPrefix,
            indexSuffix
          );
        }
      },
    },
    {
      component,
      version: 4,
      // Convergence migration for already-applied v3 DBs that landed on
      // `max_attempts INTEGER DEFAULT 23` before the in-place v3 fix
      // shipped. These DBs have the v3 bookkeeping row in
      // `_storage_migrations` and would never re-run v3, so the default
      // would stay at 23 indefinitely — Postgres parity (default 10) would
      // never apply. v4 idempotently re-runs the same rebuild helper. On
      // fresh installs (and on DBs whose v3 already converged inside v3's
      // block above) the includes(...) guard turns this into a no-op.
      description:
        "Converge SQLite queue max_attempts DEFAULT 23 → 10 on pre-fix v3 DBs (idempotent rebuild). User-defined triggers on the queue table are preserved; user-defined views referencing the queue table are NOT preserved and must be DROPped before this migration runs and re-created afterwards by the operator (SQLite's drop+rename leaves a dependent view invalid mid-rebuild and fails the txn).",
      up(db: Sqlite.Database) {
        type TableSqlRow = { readonly sql: string | null };
        const tableSqlRow = db
          .prepare<
            [string],
            TableSqlRow
          >("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
          .get(tableName);
        if (!tableSqlRow?.sql) return;
        if (tableSqlRow.sql.includes("max_attempts INTEGER DEFAULT 10")) return;
        rebuildSqliteQueueTableForV4Default(
          db,
          tableName,
          prefixColumnsSql,
          postV3ColumnList,
          prefixIndexPrefix,
          indexSuffix
        );
      },
    },
  ];
}
