/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATION = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../providers/supabase/migrations/0002_shared_documents.sql"
);

describe("shared_documents RLS tenant isolation", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(readFileSync(MIGRATION, "utf8"));
    // PGlite's default "postgres" user has rolbypassrls=true, so even
    // FORCE ROW LEVEL SECURITY is bypassed. We create a non-superuser role
    // and switch to it so RLS policies are evaluated normally.
    await db.exec(`
      CREATE ROLE rls_test_user LOGIN;
      GRANT ALL ON shared_documents TO rls_test_user;
      SET SESSION AUTHORIZATION rls_test_user;
    `);
    // Establish the tenant-a JWT claim for this session (false = session-level,
    // not transaction-local, so it persists across separate query() calls).
    await db.query(`SELECT set_config('request.jwt.claims', '{"sub":"tenant-a"}', false)`);
  });

  it("allows inserting a row stamped with the current tenant", async () => {
    await expect(
      db.query(
        `INSERT INTO shared_documents (doc_id, kb_id, tenant_id, project_id, data)
         VALUES ('doc-ok', 'kb-1', 'tenant-a', 'proj-1', 'content-a')`
      )
    ).resolves.toBeDefined();
  });

  it("rejects inserting a row stamped with a different tenant (WITH CHECK)", async () => {
    await expect(
      db.query(
        `INSERT INTO shared_documents (doc_id, kb_id, tenant_id, project_id, data)
         VALUES ('doc-bad', 'kb-1', 'tenant-b', 'proj-1', 'content-b')`
      )
    ).rejects.toThrow();
  });

  it("returns only the current tenant's rows on select", async () => {
    const res = await db.query<{ doc_id: string; tenant_id: string }>(
      `SELECT doc_id, tenant_id FROM shared_documents WHERE kb_id = 'kb-1' AND project_id = 'proj-1'`
    );
    expect(res.rows.every((r) => r.tenant_id === "tenant-a")).toBe(true);
    expect(res.rows.some((r) => r.tenant_id === "tenant-b")).toBe(false);
  });
});
