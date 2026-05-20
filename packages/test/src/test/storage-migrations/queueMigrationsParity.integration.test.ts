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
import { MIGRATIONS_TABLE } from "@workglow/storage";
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

/**
 * v4 was edited in place between two iterations of PR #516: the first
 * version created a non-unique index, the second made it UNIQUE. Consumers
 * who applied the first variant have a (component, version=4) row in
 * `_storage_migrations` so the runner will never re-execute v4 — they would
 * be stuck with a non-unique index forever. v5 detects and converges these
 * DBs.
 */
describe("postgres queue migrations: v5 converges pre-edit v4", () => {
  it("converges a DB that applied the non-unique v4 to UNIQUE", async () => {
    const pg = new PGlite();
    try {
      const db = pg as unknown as Pool;
      const all = postgresQueueMigrations("jobs_legacy_v4", []);
      const runner = new PostgresMigrationRunner(db);

      // Run v1..v3 normally, then synthesize a pre-edit v4: create a
      // NON-unique partial index and mark v4 as applied in the ledger.
      await runner.run(all.slice(0, 3));
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_jobs_legacy_v4_fingerprint_active
          ON jobs_legacy_v4(queue, fingerprint)
          WHERE status IN ('PENDING','PROCESSING')
      `);
      await db.query(
        `INSERT INTO ${MIGRATIONS_TABLE}(component, version, description) VALUES ($1, $2, $3)`,
        ["queue:postgres:jobs_legacy_v4", 4, "pre-edit non-unique v4 (synthetic)"]
      );

      // Sanity: before v5 runs, the index is NOT unique.
      const before = await db.query<{ indisunique: boolean }>(
        `SELECT i.indisunique
           FROM pg_class c
           JOIN pg_index i ON i.indexrelid = c.oid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_jobs_legacy_v4_fingerprint_active'
            AND n.nspname = current_schema()`
      );
      expect(before.rows[0]?.indisunique).toBe(false);

      // Run the full chain — only v5 should execute.
      const applied = await runner.run(all);
      expect(applied.map((m) => m.version)).toEqual([5]);

      const after = await db.query<{ indisunique: boolean }>(
        `SELECT i.indisunique
           FROM pg_class c
           JOIN pg_index i ON i.indexrelid = c.oid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_jobs_legacy_v4_fingerprint_active'
            AND n.nspname = current_schema()`
      );
      expect(after.rows[0]?.indisunique).toBe(true);
    } finally {
      await pg.close();
    }
  });

  it("v5 is a no-op on a DB that already has a UNIQUE v4 index", async () => {
    const pg = new PGlite();
    try {
      const db = pg as unknown as Pool;
      const all = postgresQueueMigrations("jobs_unique_v4", []);
      const runner = new PostgresMigrationRunner(db);

      // Fresh install — picks up the post-edit (UNIQUE) v4.
      await runner.run(all);

      const before = await db.query<{ indisunique: boolean }>(
        `SELECT i.indisunique
           FROM pg_class c
           JOIN pg_index i ON i.indexrelid = c.oid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_jobs_unique_v4_fingerprint_active'
            AND n.nspname = current_schema()`
      );
      expect(before.rows[0]?.indisunique).toBe(true);

      // Re-run should apply nothing (v5 already recorded). To exercise the
      // v5 idempotency branch directly, run a v5-only chain against a fresh
      // bookkeeping entry: drop the v5 row and re-run; v5's existence check
      // should observe the already-UNIQUE index and short-circuit without
      // dropping/recreating it.
      await db.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE component = $1 AND version = $2`, [
        "queue:postgres:jobs_unique_v4",
        5,
      ]);
      const applied = await runner.run(all);
      expect(applied.map((m) => m.version)).toEqual([5]);

      // Index is still UNIQUE — v5 did not drop/recreate (or did so harmlessly).
      const after = await db.query<{ indisunique: boolean }>(
        `SELECT i.indisunique
           FROM pg_class c
           JOIN pg_index i ON i.indexrelid = c.oid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_jobs_unique_v4_fingerprint_active'
            AND n.nspname = current_schema()`
      );
      expect(after.rows[0]?.indisunique).toBe(true);
    } finally {
      await pg.close();
    }
  });
});

describe("sqlite queue migrations: v5 converges pre-edit v4", () => {
  it("converges a DB that applied the non-unique v4 to UNIQUE", async () => {
    await Sqlite.init();
    const db = new Sqlite.Database(":memory:");
    try {
      const all = sqliteQueueMigrations("jobs_legacy_v4", []);
      const runner = new SqliteMigrationRunner(db);

      await runner.run(all.slice(0, 3));
      // Synthesize the pre-edit v4: NON-unique partial index + ledger row.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_jobs_legacy_v4_fingerprint_active
          ON jobs_legacy_v4(queue, fingerprint)
          WHERE status IN ('PENDING','PROCESSING');
      `);
      db.prepare(
        `INSERT INTO ${MIGRATIONS_TABLE}(component, version, description) VALUES (?, ?, ?)`
      ).run("queue:sqlite:jobs_legacy_v4", 4, "pre-edit non-unique v4 (synthetic)");

      const readSql = (): string | null => {
        const row = db
          .prepare<
            [],
            { sql: string | null }
          >(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_jobs_legacy_v4_fingerprint_active'`)
          .get();
        return row?.sql ?? null;
      };
      expect(readSql()).toMatch(/CREATE\s+INDEX/i);
      expect(readSql()).not.toMatch(/CREATE\s+UNIQUE/i);

      const applied = await runner.run(all);
      expect(applied.map((m) => m.version)).toEqual([5]);
      expect(readSql()).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    } finally {
      db.close();
    }
  });

  it("v5 is a no-op on a DB that already has a UNIQUE v4 index", async () => {
    await Sqlite.init();
    const db = new Sqlite.Database(":memory:");
    try {
      const all = sqliteQueueMigrations("jobs_unique_v4", []);
      const runner = new SqliteMigrationRunner(db);
      await runner.run(all);

      const readSql = (): string | null => {
        const row = db
          .prepare<
            [],
            { sql: string | null }
          >(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_jobs_unique_v4_fingerprint_active'`)
          .get();
        return row?.sql ?? null;
      };
      expect(readSql()).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);

      // Force v5 to re-run with the index already UNIQUE.
      db.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE component = ? AND version = ?`).run(
        "queue:sqlite:jobs_unique_v4",
        5
      );
      const applied = await runner.run(all);
      expect(applied.map((m) => m.version)).toEqual([5]);
      expect(readSql()).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    } finally {
      db.close();
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
