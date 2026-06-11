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

describe("kb_chunks pgvector migration", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite({ extensions: { vector } });
    // Register first; the migration's own `create extension if not exists vector`
    // then succeeds against the registered extension.
    await db.exec(readFileSync(MIGRATION, "utf8"));
  });

  it("creates kb_chunks_768 and ranks by cosine via match_kb_chunks_768", async () => {
    const mk = (a: number[]) => `[${a.join(",")}]`;
    const base = Array(768).fill(0);
    const near = [...base];
    near[0] = 1;
    const far = [...base];
    far[1] = 1;
    const q = [...base];
    q[0] = 1;

    for (const [id, vec] of [
      ["near", near],
      ["far", far],
    ] as const) {
      await db.query(
        `INSERT INTO kb_chunks_768 (chunk_id, doc_id, kb_id, tenant_id, project_id, vector, metadata)
         VALUES ($1,'d','kb','t','p',$2::vector,'{"text":"x"}'::jsonb)`,
        [id, mk(vec)]
      );
    }
    const res = await db.query<{ chunk_id: string; score: number }>(
      `SELECT * FROM match_kb_chunks_768($1::vector, 10, 0, 't', 'p', 'kb', '{}'::jsonb)`,
      [mk(q)]
    );
    expect(res.rows[0].chunk_id).toBe("near");
    expect(Number(res.rows[0].score)).toBeGreaterThan(Number(res.rows[1].score));
  });
});
