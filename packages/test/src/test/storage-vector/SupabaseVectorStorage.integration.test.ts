/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { createClient } from "@supabase/supabase-js";
import { StorageValidationError } from "@workglow/storage";
import { SupabaseVectorStorage } from "@workglow/supabase/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSupabaseMockClient,
  type IClosableSupabaseClient,
} from "../helpers/SupabaseMockClient";

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

  it("returns rows when score_threshold is NULL (no silent empty result)", async () => {
    const mk = (a: number[]) => `[${a.join(",")}]`;
    const v = Array(768).fill(0);
    v[0] = 1;
    await db.query(
      `INSERT INTO kb_chunks_768 (chunk_id, doc_id, kb_id, tenant_id, project_id, vector, metadata)
       VALUES ('n1','d','kb','t2','p',$1::vector,'{}'::jsonb)`,
      [mk(v)]
    );
    const res = await db.query(
      `SELECT * FROM match_kb_chunks_768($1::vector, 10, NULL, 't2', 'p', 'kb', '{}'::jsonb)`,
      [mk(v)]
    );
    expect(res.rows.length).toBe(1);
  });

  const DIMS = [384, 768, 1024, 1536, 3072] as const;
  it.each(DIMS)("creates kb_chunks_%i with a working match RPC", async (dim) => {
    const mk = (a: number[]) => `[${a.join(",")}]`;
    const base = Array(dim).fill(0);
    const near = [...base];
    near[0] = 1;
    const q = [...base];
    q[0] = 1;
    await db.query(
      `INSERT INTO kb_chunks_${dim} (chunk_id, doc_id, kb_id, tenant_id, project_id, vector, metadata)
       VALUES ('a','d','kb','dim${dim}','p',$1::vector,'{}'::jsonb)`,
      [mk(near)]
    );
    const res = await db.query(
      `SELECT * FROM match_kb_chunks_${dim}($1::vector, 5, 0, 'dim${dim}', 'p', 'kb', '{}'::jsonb)`,
      [mk(q)]
    );
    expect(res.rows.length).toBe(1);
  });

  it("ranks by cosine in kb_chunks_3072 (halfvec-cast ORDER BY path)", async () => {
    const mk = (a: number[]) => `[${a.join(",")}]`;
    const base = Array(3072).fill(0);
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
        `INSERT INTO kb_chunks_3072 (chunk_id, doc_id, kb_id, tenant_id, project_id, vector, metadata)
         VALUES ($1,'d','kb','rank3072','p',$2::vector,'{}'::jsonb)`,
        [id, mk(vec)]
      );
    }
    const res = await db.query<{ chunk_id: string; score: number }>(
      `SELECT * FROM match_kb_chunks_3072($1::vector, 10, 0, 'rank3072', 'p', 'kb', '{}'::jsonb)`,
      [mk(q)]
    );
    expect(res.rows[0].chunk_id).toBe("near");
    expect(Number(res.rows[0].score)).toBeGreaterThan(Number(res.rows[1].score));
  });
});

const VecSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string" },
    doc_id: { type: "string" },
    kb_id: { type: "string" },
    tenant_id: { type: "string" },
    project_id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["chunk_id", "doc_id", "kb_id", "tenant_id", "project_id", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
const VecPK = ["chunk_id", "kb_id", "tenant_id", "project_id"] as const;

function mk768(set: Record<number, number>): Float32Array {
  const arr = new Float32Array(768);
  for (const [i, v] of Object.entries(set)) arr[Number(i)] = v;
  return arr;
}

describe("SupabaseVectorStorage", () => {
  it("binds dimensions and table name at construction (Task 3)", () => {
    const store = new SupabaseVectorStorage(
      createClient("http://localhost", "test-key"),
      "kb_chunks_768",
      VecSchema,
      VecPK,
      [],
      768
    );
    expect(store.getVectorDimensions()).toBe(768);
    expect(store.tableName).toBe("kb_chunks_768");
  });

  it("throws when used without a scope (Task 6)", async () => {
    const store = new SupabaseVectorStorage(
      createClient("http://localhost", "test-key"),
      "kb_chunks_768",
      VecSchema,
      VecPK,
      [],
      768
    );
    await expect(store.similaritySearch(mk768({ 0: 1 }))).rejects.toBeInstanceOf(
      StorageValidationError
    );
  });

  describe("put + similaritySearch against PGlite-backed mock (Tasks 4 & 5)", () => {
    let client: IClosableSupabaseClient;

    beforeAll(async () => {
      client = createSupabaseMockClient();
      const setup = await client.rpc("exec_sql", { query: readFileSync(MIGRATION, "utf8") });
      expect(setup.error).toBeNull();
    });

    afterAll(async () => {
      await client.close();
    });

    const scopedStore = () =>
      new SupabaseVectorStorage(
        client as unknown as ReturnType<typeof createClient>,
        "kb_chunks_768",
        VecSchema,
        VecPK,
        [],
        768
      ).withScope({
        tenant_id: "t",
        project_id: "p",
        kb_id: "kb",
      });

    it("persists scoped vectors and ranks by cosine similarity", async () => {
      const store = scopedStore();
      await store.put({
        chunk_id: "near",
        doc_id: "d",
        kb_id: "ignored",
        tenant_id: "ignored",
        project_id: "ignored",
        vector: mk768({ 0: 1 }),
        metadata: { text: "near-text" },
      } as never);
      await store.put({
        chunk_id: "far",
        doc_id: "d",
        kb_id: "ignored",
        tenant_id: "ignored",
        project_id: "ignored",
        vector: mk768({ 1: 1 }),
        metadata: { text: "far-text" },
      } as never);

      const results = await store.similaritySearch(mk768({ 0: 1 }), { topK: 10 });
      expect(results.length).toBe(2);
      expect((results[0] as { chunk_id: string }).chunk_id).toBe("near");
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect((results[0] as { vector: unknown }).vector).toBeInstanceOf(Float32Array);
      expect((results[0] as { vector: Float32Array }).vector[0]).toBeCloseTo(1, 5);
    });

    it("stamps the resolved scope onto written rows (Task 4)", async () => {
      const store = scopedStore();
      const results = await store.similaritySearch(mk768({ 0: 1 }), { topK: 10 });
      for (const row of results) {
        expect((row as { tenant_id: string }).tenant_id).toBe("t");
        expect((row as { project_id: string }).project_id).toBe("p");
        expect((row as { kb_id: string }).kb_id).toBe("kb");
      }
    });

    it("rejects unsafe metadata filter keys (Task 5)", async () => {
      const store = scopedStore();
      await expect(
        store.similaritySearch(mk768({ 0: 1 }), { filter: { "bad-key": "x" } as never })
      ).rejects.toBeInstanceOf(StorageValidationError);
    });

    it("isolates rows by scope (Task 6)", async () => {
      const other = new SupabaseVectorStorage(
        client as unknown as ReturnType<typeof createClient>,
        "kb_chunks_768",
        VecSchema,
        VecPK,
        [],
        768
      ).withScope({ tenant_id: "other", project_id: "p", kb_id: "kb" });
      const results = await other.similaritySearch(mk768({ 0: 1 }), { topK: 10 });
      expect(results.length).toBe(0);
    });
  });
});
