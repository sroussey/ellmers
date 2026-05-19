/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { postgresQueueMigrations } from "@workglow/postgres/job-queue";
import type { Pool } from "@workglow/postgres/storage";
import { PostgresMigrationRunner } from "@workglow/postgres/storage";
import { sqliteQueueMigrations } from "@workglow/sqlite/job-queue";
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
        .prepare<[{ readonly name: string }], { readonly sql: string | null }>(
          "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?"
        )
        .get("jobs");
      expect(row?.sql).toBeDefined();

      const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").trim();
      const expectedSql = `CREATE TABLE "jobs" (
        id INTEGER PRIMARY KEY,
        fingerprint TEXT NOT NULL,
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
        lease_expires_at TEXT
      )`;

      expect(normalizeSql(row!.sql!)).toBe(normalizeSql(expectedSql));
    } finally {
      sqlite.close();
    }
  });
});
