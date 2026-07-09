/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobStore } from "@workglow/job-queue";
import { JobStatus } from "@workglow/job-queue";
import { createSqliteQueue, sqliteQueueMigrations } from "@workglow/sqlite/job-queue";
import { Sqlite } from "@workglow/sqlite/storage";
import { uuid4 } from "@workglow/util";
import { describe, expect, it } from "vitest";

interface TestInput {
  readonly value: string;
}
interface TestOutput {
  readonly result: string;
}

interface BackendUnderTest {
  readonly name: string;
  readonly setup: () => Promise<{
    jobStore: IJobStore<TestInput, TestOutput>;
    queueName: string;
    assertUniqueFingerprintIndex: () => Promise<void>;
    dispose: () => Promise<void>;
  }>;
}

/**
 * With the v4 UNIQUE partial index in place, concurrent `create()` calls
 * carrying the same fingerprint MUST land on exactly one PENDING row and
 * resolve every other caller to the winner's id. Without UNIQUE the index is
 * advisory and the TOCTOU window between `findActiveByFingerprint` and
 * `INSERT` lets two rows through.
 */
function runFingerprintRace(backend: BackendUnderTest): void {
  describe(`IJobStore fingerprint race — ${backend.name}`, () => {
    it("50 concurrent create({ fingerprint: 'X' }) collapse to ONE PENDING row, all 50 ids equal", async () => {
      const { jobStore, queueName, assertUniqueFingerprintIndex, dispose } = await backend.setup();
      try {
        await assertUniqueFingerprintIndex();

        const fingerprint = `fp-race-${uuid4()}`;
        const ids = await Promise.all(
          Array.from({ length: 50 }, (_, i) =>
            jobStore.create(
              {
                input: { value: `v-${i}` },
                fingerprint,
                queue: queueName,
                visible_at: null,
                completed_at: null,
              } as any,
              { fingerprint }
            )
          )
        );

        // All callers see the same winner id.
        const unique = new Set(ids.map(String));
        expect(unique.size).toBe(1);

        // Exactly one PENDING row for this fingerprint.
        const pending = await jobStore.peek(JobStatus.PENDING, 1000);
        const matching = pending.filter((r) => r.fingerprint === fingerprint);
        expect(matching).toHaveLength(1);
      } finally {
        await dispose();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// SQLite backend
// ---------------------------------------------------------------------------
await Sqlite.init();

const sqliteBackend: BackendUnderTest = {
  name: "SQLite",
  setup: async () => {
    const db = new Sqlite.Database(":memory:");
    const queueName = `fp-race-${uuid4()}`;
    const { jobStore, messageQueue } = createSqliteQueue<TestInput, TestOutput>(queueName, db);
    await messageQueue.migrate();
    return {
      jobStore,
      queueName,
      assertUniqueFingerprintIndex: async () => {
        // Locate the partial index by name and assert it's UNIQUE.
        const tableName = `job_queue`;
        const rows = db
          .prepare<[string], { name: string; sql: string }>(
            `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND name=?`
          )
          .all(tableName, `idx_${tableName}_fingerprint_active`);
        expect(rows.length).toBeGreaterThan(0);
        const idx = rows[0]!;
        expect(idx.sql).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
        expect(idx.sql).toMatch(/WHERE\s+status\s+IN\s*\(\s*'PENDING','PROCESSING'/i);
      },
      dispose: async () => {
        await jobStore.deleteAll();
        db.close();
      },
    };
  },
};

runFingerprintRace(sqliteBackend);

// ---------------------------------------------------------------------------
// Migration-shape assertion (Postgres) — does NOT require a live DB, just
// inspects the migration object's SQL string. Confirms postgres v4 is
// CREATE UNIQUE INDEX matching the sqlite version's shape.
// ---------------------------------------------------------------------------
describe("Postgres fingerprint migration shape", () => {
  it("uses CREATE UNIQUE INDEX with PENDING/PROCESSING partial predicate", async () => {
    const { postgresQueueMigrations } = await import("@workglow/postgres/job-queue");
    const migs = postgresQueueMigrations("job_queue", []);
    const v1 = migs.find((m: any) => m.version === 1) as any;
    expect(v1).toBeDefined();

    const queries: string[] = [];
    await v1.up({ query: async (sql: string) => queries.push(sql) } as any);
    const joined = queries.join("\n");
    expect(joined).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(joined).toMatch(/WHERE\s+status\s+IN\s*\(\s*'PENDING','PROCESSING'/i);
  });
});

// ---------------------------------------------------------------------------
// Migration-shape assertion (SQLite)
// ---------------------------------------------------------------------------
describe("SQLite fingerprint migration shape", () => {
  it("uses CREATE UNIQUE INDEX with PENDING/PROCESSING partial predicate", async () => {
    const migs = sqliteQueueMigrations("job_queue", []);
    const v1 = migs.find((m) => m.version === 1) as any;
    expect(v1).toBeDefined();
    const queries: string[] = [];
    await v1.up({ exec: (sql: string) => queries.push(sql) } as any);
    const joined = queries.join("\n");
    expect(joined).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(joined).toMatch(/WHERE\s+status\s+IN\s*\(\s*'PENDING','PROCESSING'/i);
  });
});
