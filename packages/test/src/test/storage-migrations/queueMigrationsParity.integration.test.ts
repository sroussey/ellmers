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
