/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATION = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../providers/supabase/migrations/0001_kb_chunks_pgvector.sql"
);

const mk = (dim: number, set: Record<number, number> = {}): string => {
  const arr = Array(dim).fill(0);
  for (const [i, v] of Object.entries(set)) arr[Number(i)] = v;
  return `[${arr.join(",")}]`;
};

describe("kb_chunks RLS tenant isolation", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { vector } });
    await db.exec(readFileSync(MIGRATION, "utf8"));
    // PGlite's default "postgres" user has rolbypassrls=true, so even
    // FORCE ROW LEVEL SECURITY is bypassed. We create a non-superuser role
    // and switch to it so RLS policies are evaluated normally.
    await db.exec(`
      CREATE ROLE rls_test_user LOGIN;
      GRANT ALL ON kb_chunks_768 TO rls_test_user;
      SET SESSION AUTHORIZATION rls_test_user;
    `);
    // Establish the tenant-a JWT claim for this session (false = session-level,
    // not transaction-local, so it persists across separate query() calls).
    await db.query(`SELECT set_config('request.jwt.claims', '{"sub":"tenant-a"}', false)`);
  });

  it("allows inserting a row stamped with the current tenant", async () => {
    await expect(
      db.query(
        `INSERT INTO kb_chunks_768 (chunk_id, doc_id, kb_id, tenant_id, project_id, vector, metadata)
         VALUES ('rls-ok','d','kb','tenant-a','p',$1::vector,'{}'::jsonb)`,
        [mk(768, { 0: 1 })]
      )
    ).resolves.toBeDefined();
  });

  it("rejects inserting a row stamped with a different tenant (WITH CHECK)", async () => {
    await expect(
      db.query(
        `INSERT INTO kb_chunks_768 (chunk_id, doc_id, kb_id, tenant_id, project_id, vector, metadata)
         VALUES ('rls-bad','d','kb','tenant-b','p',$1::vector,'{}'::jsonb)`,
        [mk(768, { 1: 1 })]
      )
    ).rejects.toThrow();
  });

  it("returns only the current tenant's rows on select", async () => {
    const res = await db.query<{ chunk_id: string; tenant_id: string }>(
      `SELECT chunk_id, tenant_id FROM kb_chunks_768 WHERE kb_id = 'kb' AND project_id = 'p'`
    );
    expect(res.rows.every((r) => r.tenant_id === "tenant-a")).toBe(true);
    expect(res.rows.some((r) => r.tenant_id === "tenant-b")).toBe(false);
  });
});
