/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { postgresQueueMigrations } from "@workglow/postgres/job-queue";
import type { Pool } from "@workglow/postgres/storage";
import { PostgresMigrationRunner } from "@workglow/postgres/storage";
import { buildSqliteQueuePostV3TableSql, sqliteQueueMigrations } from "@workglow/sqlite/job-queue";
import { Sqlite, SqliteMigrationRunner } from "@workglow/sqlite/storage";
import { describe, expect, it } from "vitest";

/**
 * Verifies the v1→v2→v3 migration chain produces schema parity with a
 * manually-built "fresh-install" DB: regardless of whether you arrive via
 * the legacy v1 columns or a brand-new install, the final schema after v3
 * must be byte-identical (column names, types, defaults, and indexes).
 *
 * The frozen-v1 invariant requires this: v1 MUST keep creating the legacy
 * names (run_after / run_attempts / max_retries / last_ran_at / worker_id),
 * and v3 MUST IF-EXISTS-rename them. Fresh installs run v1 → v2 → v3 too,
 * so v3's IF EXISTS guards must turn into no-ops cleanly.
 */
describe("postgres queue migrations: v1→v2→v3 schema parity", () => {
  it("fresh install lands on the same schema as a legacy install", async () => {
    const a = new PGlite();
    const b = new PGlite();
    try {
      const dbA = a as unknown as Pool;
      const dbB = b as unknown as Pool;

      // (1) Run the full migration chain on a fresh DB ("install A").
      const runnerA = new PostgresMigrationRunner(dbA);
      await runnerA.run(postgresQueueMigrations("jobs_a", []));

      // (2) Build a synthetic "already migrated to v1" DB by running ONLY
      // v1 (this is what an existing deployment looks like before this PR),
      // then continue with v2 and v3.
      const allB = postgresQueueMigrations("jobs_b", []);
      const runnerB = new PostgresMigrationRunner(dbB);
      await runnerB.run([allB[0]]); // v1 only
      // Then run the rest of the chain on the legacy DB.
      await runnerB.run(allB);

      const finalCols = async (db: Pool, tbl: string): Promise<string[]> => {
        const r = await db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
             WHERE table_name = $1 AND table_schema = current_schema()
             ORDER BY column_name`,
          [tbl]
        );
        return r.rows.map((row) => row.column_name);
      };

      const colsA = await finalCols(dbA, "jobs_a");
      const colsB = await finalCols(dbB, "jobs_b");
      expect(colsA).toEqual(colsB);
      // Final schema must use the NEW names — no legacy names should remain.
      for (const legacy of [
        "run_after",
        "run_attempts",
        "max_retries",
        "last_ran_at",
        "worker_id",
      ]) {
        expect(colsA).not.toContain(legacy);
      }
      for (const renamed of [
        "visible_at",
        "attempts",
        "max_attempts",
        "last_attempted_at",
        "lease_owner",
      ]) {
        expect(colsA).toContain(renamed);
      }
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe("sqlite queue migrations: v1→v2→v3 schema parity", () => {
  it("fresh install lands on the same schema as a legacy install", async () => {
    await Sqlite.init();
    const dbA = new Sqlite.Database(":memory:");
    const dbB = new Sqlite.Database(":memory:");
    try {
      const runnerA = new SqliteMigrationRunner(dbA);
      await runnerA.run(sqliteQueueMigrations("jobs_a", []));

      const allB = sqliteQueueMigrations("jobs_b", []);
      const runnerB = new SqliteMigrationRunner(dbB);
      await runnerB.run([allB[0]]);
      await runnerB.run(allB);

      const finalCols = (db: Sqlite.Database, tbl: string): string[] =>
        db
          .prepare<[], { name: string }>(`PRAGMA table_info(${tbl})`)
          .all()
          .map((r) => r.name)
          .sort();

      const colsA = finalCols(dbA, "jobs_a");
      const colsB = finalCols(dbB, "jobs_b");
      expect(colsA).toEqual(colsB);
      for (const legacy of [
        "run_after",
        "run_attempts",
        "max_retries",
        "last_ran_at",
        "worker_id",
      ]) {
        expect(colsA).not.toContain(legacy);
      }
      for (const renamed of [
        "visible_at",
        "attempts",
        "max_attempts",
        "last_attempted_at",
        "lease_owner",
      ]) {
        expect(colsA).toContain(renamed);
      }
    } finally {
      dbA.close();
      dbB.close();
    }
  });
});

/**
 * PR #511 follow-up: SQLite v3 originally renamed `max_retries → max_attempts`
 * but did not adjust the column default, leaving SQLite fresh installs at
 * `DEFAULT 23` while Postgres landed on `DEFAULT 10`. Callers omitting
 * `maxAttempts` got divergent retry behavior across backends. This block
 * compares the post-migration column DEFAULTS (not just the column names)
 * so future drift is caught.
 */
describe("queue migrations: cross-backend default parity", () => {
  it("max_attempts default is 10 on both Postgres and SQLite after v3", async () => {
    // ── (1) Fresh PGlite + run all Postgres queue migrations.
    const pg = new PGlite();
    // ── (2) Fresh SQLite :memory: + run all SQLite queue migrations.
    await Sqlite.init();
    const sqlite = new Sqlite.Database(":memory:");
    try {
      await new PostgresMigrationRunner(pg as unknown as Pool).run(
        postgresQueueMigrations("jobs", [])
      );
      await new SqliteMigrationRunner(sqlite).run(sqliteQueueMigrations("jobs", []));

      // ── (3) Read Postgres defaults via information_schema.columns.
      const pgRows = (
        await (pg as unknown as Pool).query<{
          column_name: string;
          column_default: string | null;
        }>(
          `SELECT column_name, column_default FROM information_schema.columns
             WHERE table_name = $1 AND table_schema = current_schema()
               AND column_name IN ('max_attempts', 'attempts')`,
          ["jobs"]
        )
      ).rows;
      const pgMaxAttempts = pgRows.find((r) => r.column_name === "max_attempts");
      const pgAttempts = pgRows.find((r) => r.column_name === "attempts");
      expect(pgMaxAttempts).toBeDefined();
      expect(pgAttempts).toBeDefined();

      // ── (4) Read SQLite defaults via PRAGMA table_info(jobs).
      type SqliteCol = { name: string; dflt_value: string | null };
      const sqliteRows = sqlite
        .prepare<[], SqliteCol>(`PRAGMA table_info(jobs)`)
        .all()
        .filter((r: SqliteCol) => r.name === "max_attempts" || r.name === "attempts");
      const sqliteMaxAttempts = sqliteRows.find((r) => r.name === "max_attempts");
      const sqliteAttempts = sqliteRows.find((r) => r.name === "attempts");
      expect(sqliteMaxAttempts).toBeDefined();
      expect(sqliteAttempts).toBeDefined();

      // ── (5) Both backends MUST agree on the integer values of the
      // defaults. Number(...) coerces the SQL-literal string forms
      // ("10", "0") into JS numbers so the comparison is back-end-agnostic.
      expect(Number(pgMaxAttempts!.column_default)).toBe(10);
      expect(Number(sqliteMaxAttempts!.dflt_value)).toBe(10);

      // Sanity check: `attempts` defaults to 0 on both backends.
      expect(Number(pgAttempts!.column_default)).toBe(0);
      expect(Number(sqliteAttempts!.dflt_value)).toBe(0);
    } finally {
      await pg.close();
      sqlite.close();
    }
  });
});

describe("sqlite queue migrations: canonical v3 schema", () => {
  it("rebuilds the table from the explicit post-v3 CREATE TABLE statement", async () => {
    await Sqlite.init();
    const sqlite = new Sqlite.Database(":memory:");
    try {
      await new SqliteMigrationRunner(sqlite).run(sqliteQueueMigrations("jobs", []));

      const row = sqlite
        .prepare<
          [string],
          { readonly sql: string | null }
        >("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get("jobs");
      expect(row?.sql).toBeDefined();

      const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").trim();
      expect(normalizeSql(row!.sql!)).toBe(
        normalizeSql(buildSqliteQueuePostV3TableSql("jobs", ""))
      );
    } finally {
      sqlite.close();
    }
  });
});

/**
 * H1: v4 migration converges already-applied pre-fix v3 DBs.
 *
 * Pre-fix v3 only IF-EXISTS-renamed columns; it did not rebuild the table to
 * change `max_attempts DEFAULT 23 → 10`. DBs that ran the pre-fix v3 have a
 * v3 bookkeeping row in `_storage_migrations` and would never re-run v3, so
 * the default stays at 23 indefinitely — Postgres parity (default 10) never
 * applies. v4 idempotently re-runs the same rebuild helper so converged DBs
 * (fresh installs that hit the in-place v3 rebuild) get a no-op while
 * pre-fix v3 DBs get repaired.
 */
describe("sqlite queue migrations: v4 max_attempts convergence", () => {
  const MIGRATIONS_LEDGER = "_storage_migrations";

  /** Hand-build a pre-fix-v3 DB: run v1 + v2, perform the v3 renames, mark
   * v3 applied in the ledger — but DO NOT rebuild the table to DEFAULT 10.
   * This is the on-disk shape a deployment that ran the pre-fix migration
   * would have. */
  function fabricatePreFixV3Db(
    db: import("@workglow/sqlite/storage").Sqlite.Database,
    tableName: string
  ): void {
    const all = sqliteQueueMigrations(tableName, []);
    // Run v1's CREATE TABLE statement directly (which lands DEFAULT 23 on
    // `max_retries`).
    all[0]!.up(db, () => {});
    // Run v2's ALTER TABLE ADD COLUMNs.
    all[1]!.up(db, () => {});

    // Replicate v3's IF-EXISTS column renames *without* the post-rebuild.
    db.exec(`ALTER TABLE ${tableName} RENAME COLUMN run_after TO visible_at;`);
    db.exec(`ALTER TABLE ${tableName} RENAME COLUMN last_ran_at TO last_attempted_at;`);
    db.exec(`ALTER TABLE ${tableName} RENAME COLUMN run_attempts TO attempts;`);
    db.exec(`ALTER TABLE ${tableName} RENAME COLUMN max_retries TO max_attempts;`);
    db.exec(`ALTER TABLE ${tableName} RENAME COLUMN worker_id TO lease_owner;`);

    // Mark v1, v2, v3 as applied in the migrations ledger so the runner
    // skips them and only runs v4. We also need the ledger table to exist.
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER} (
        component TEXT NOT NULL,
        version INTEGER NOT NULL,
        description TEXT,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (component, version)
      );
      INSERT INTO ${MIGRATIONS_LEDGER}(component, version, description) VALUES
        ('queue:sqlite:${tableName}', 1, 'v1'),
        ('queue:sqlite:${tableName}', 2, 'v2'),
        ('queue:sqlite:${tableName}', 3, 'pre-fix v3 (no rebuild)');
    `);
  }

  const getMaxAttemptsDefault = (
    db: import("@workglow/sqlite/storage").Sqlite.Database,
    tbl: string
  ): string | null =>
    db
      .prepare<[], { name: string; dflt_value: string | null }>(`PRAGMA table_info(${tbl})`)
      .all()
      .find((r) => r.name === "max_attempts")?.dflt_value ?? null;

  it("DB stuck at max_attempts DEFAULT 23 (simulated pre-fix v3) is repaired by v4", async () => {
    await Sqlite.init();
    const sqlite = new Sqlite.Database(":memory:");
    try {
      fabricatePreFixV3Db(sqlite, "jobs");

      // Sanity precondition: this synthetic DB really *is* stuck at 23.
      expect(Number(getMaxAttemptsDefault(sqlite, "jobs"))).toBe(23);

      // Run the full migration list — only v4 should fire.
      const applied = await new SqliteMigrationRunner(sqlite).run(
        sqliteQueueMigrations("jobs", [])
      );
      expect(applied.map((m) => m.version)).toEqual([4]);

      // Post-condition: default is now 10 (matches Postgres parity).
      expect(Number(getMaxAttemptsDefault(sqlite, "jobs"))).toBe(10);
    } finally {
      sqlite.close();
    }
  });

  it("v4 is no-op on a fixed-v3 DB (fresh install)", async () => {
    await Sqlite.init();
    const sqlite = new Sqlite.Database(":memory:");
    try {
      // Fresh install runs the full chain; v3's in-place rebuild already
      // converged the default to 10, so v4 should detect that and skip.
      const firstRun = await new SqliteMigrationRunner(sqlite).run(
        sqliteQueueMigrations("jobs", [])
      );
      expect(firstRun.map((m) => m.version)).toEqual([1, 2, 3, 4]);
      expect(Number(getMaxAttemptsDefault(sqlite, "jobs"))).toBe(10);

      // Capture the table SQL to assert v4 left it untouched on re-run.
      const beforeSql = sqlite
        .prepare<
          [string],
          { readonly sql: string | null }
        >("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get("jobs")?.sql;

      // Second `run()` should apply nothing — ledger already has v1..v4.
      const secondRun = await new SqliteMigrationRunner(sqlite).run(
        sqliteQueueMigrations("jobs", [])
      );
      expect(secondRun).toEqual([]);

      const afterSql = sqlite
        .prepare<
          [string],
          { readonly sql: string | null }
        >("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get("jobs")?.sql;
      expect(afterSql).toBe(beforeSql);
    } finally {
      sqlite.close();
    }
  });

  it("data is preserved across v4 rebuild", async () => {
    await Sqlite.init();
    const sqlite = new Sqlite.Database(":memory:");
    try {
      fabricatePreFixV3Db(sqlite, "jobs");

      // Insert representative rows into the pre-fix v3 table.
      sqlite.exec(`
        INSERT INTO jobs (
          fingerprint, queue, job_run_id, status, input, output, attempts,
          max_attempts, visible_at, last_attempted_at, created_at,
          completed_at, deadline_at, error, error_code, progress,
          progress_message, progress_details, lease_owner,
          abort_requested_at, lease_expires_at
        ) VALUES
        ('fp1', 'q', 'run-1', 'PENDING', '{"x":1}', NULL, 0,
          23, '2025-01-01T00:00:00Z', NULL, '2025-01-01T00:00:00Z',
          NULL, NULL, NULL, NULL, 0,
          '', NULL, NULL,
          NULL, NULL),
        ('fp2', 'q', 'run-2', 'COMPLETED', '{"x":2}', '{"y":2}', 1,
          5, '2025-01-02T00:00:00Z', '2025-01-02T00:00:01Z',
          '2025-01-02T00:00:00Z', '2025-01-02T00:00:02Z', NULL, NULL,
          NULL, 100, 'done', NULL, NULL, NULL, NULL);
      `);

      await new SqliteMigrationRunner(sqlite).run(sqliteQueueMigrations("jobs", []));

      const rows = sqlite
        .prepare<
          [],
          { fingerprint: string; status: string; max_attempts: number }
        >("SELECT fingerprint, status, max_attempts FROM jobs ORDER BY fingerprint")
        .all();
      expect(rows).toEqual([
        { fingerprint: "fp1", status: "PENDING", max_attempts: 23 },
        { fingerprint: "fp2", status: "COMPLETED", max_attempts: 5 },
      ]);

      // The column DEFAULT is what changed — existing row values are
      // preserved as-is. New inserts without an explicit max_attempts now
      // get 10.
      sqlite.exec(`
        INSERT INTO jobs (fingerprint, queue, job_run_id, status, input,
          visible_at, created_at)
        VALUES ('fp3', 'q', 'run-3', 'PENDING', '{"x":3}',
          '2025-01-03T00:00:00Z', '2025-01-03T00:00:00Z');
      `);
      const newRow = sqlite
        .prepare<
          [],
          { max_attempts: number }
        >("SELECT max_attempts FROM jobs WHERE fingerprint = 'fp3'")
        .get();
      expect(newRow?.max_attempts).toBe(10);
    } finally {
      sqlite.close();
    }
  });

  it("v4 preserves user-defined triggers on the queue table", async () => {
    await Sqlite.init();
    const sqlite = new Sqlite.Database(":memory:");
    try {
      fabricatePreFixV3Db(sqlite, "jobs");

      // User-defined trigger + audit table referencing the queue table.
      sqlite.exec(`
        CREATE TABLE audit (job_fp TEXT, status TEXT);
        CREATE TRIGGER jobs_audit_trg AFTER UPDATE OF status ON jobs
        BEGIN
          INSERT INTO audit (job_fp, status) VALUES (NEW.fingerprint, NEW.status);
        END;
      `);

      // Seed and assert the trigger is alive before v4 rebuilds the table.
      sqlite.exec(`
        INSERT INTO jobs (fingerprint, queue, job_run_id, status, input,
          visible_at, created_at)
        VALUES ('fp1', 'q', 'r', 'PENDING', '{}',
          '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
      `);

      await new SqliteMigrationRunner(sqlite).run(sqliteQueueMigrations("jobs", []));

      // The trigger should still be present after v4's drop+rename.
      const triggers = sqlite
        .prepare<
          [],
          { name: string }
        >("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'jobs'")
        .all();
      expect(triggers.map((t) => t.name)).toContain("jobs_audit_trg");

      // And it must still fire — write to status and check the audit row.
      sqlite.exec("UPDATE jobs SET status = 'COMPLETED' WHERE fingerprint = 'fp1';");
      const audit = sqlite
        .prepare<[], { job_fp: string; status: string }>("SELECT job_fp, status FROM audit")
        .all();
      expect(audit).toContainEqual({ job_fp: "fp1", status: "COMPLETED" });
    } finally {
      sqlite.close();
    }
  });

  it("v4 restores foreign_keys pragma to prior value", async () => {
    await Sqlite.init();
    const sqlite = new Sqlite.Database(":memory:");
    try {
      // Caller opted into FK enforcement before running migrations.
      sqlite.exec("PRAGMA foreign_keys = ON;");
      fabricatePreFixV3Db(sqlite, "jobs");

      await new SqliteMigrationRunner(sqlite).run(sqliteQueueMigrations("jobs", []));

      const fk = sqlite.prepare<[], { foreign_keys: number }>("PRAGMA foreign_keys").get();
      expect(fk?.foreign_keys).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
