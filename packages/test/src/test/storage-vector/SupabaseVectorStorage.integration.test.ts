/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { createClient } from "@supabase/supabase-js";
import { StorageValidationError } from "@workglow/storage";
import { SupabaseVectorStorage } from "@workglow/supabase/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSupabaseMockClient,
  type IClosableSupabaseClient,
} from "../helpers/SupabaseMockClient";

// A generic vector table + a generic `match_<table>` RPC. The storage knows
// nothing of these column names — the function decides how to apply the generic
// `p_scope` map (here it scopes on an `owner` column) and `p_filter`.
const SETUP_SQL = `
  create extension if not exists vector;
  create table vec_items (
    id       text not null,
    owner    text not null default '',
    vector   vector(4) not null,
    metadata jsonb not null default '{}'::jsonb,
    primary key (id, owner)
  );
  create or replace function match_vec_items(
    query_embedding vector(4),
    match_count     int,
    score_threshold float,
    p_scope         jsonb,
    p_filter        jsonb
  )
  returns table (id text, owner text, vector vector(4), metadata jsonb, score float)
  language sql stable
  as $$
    select c.id, c.owner, c.vector, c.metadata,
           (1 - (c.vector <=> query_embedding)) as score
    from vec_items c
    where (p_scope->>'owner' is null or c.owner = p_scope->>'owner')
      and c.metadata @> p_filter
      and (score_threshold is null or (1 - (c.vector <=> query_embedding)) >= score_threshold)
    order by c.vector <=> query_embedding
    limit match_count
  $$;
`;

const VecSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    owner: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["id", "owner", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
const VecPK = ["id", "owner"] as const;

function mk(set: Record<number, number>): Float32Array {
  const arr = new Float32Array(4);
  for (const [i, v] of Object.entries(set)) arr[Number(i)] = v;
  return arr;
}

describe("SupabaseVectorStorage", () => {
  it("binds dimensions and table name at construction", () => {
    const store = new SupabaseVectorStorage(
      createClient("http://localhost", "test-key"),
      "vec_items",
      VecSchema,
      VecPK,
      [],
      4
    );
    expect(store.getVectorDimensions()).toBe(4);
    expect(store.tableName).toBe("vec_items");
  });

  describe("put + similaritySearch against PGlite-backed mock", () => {
    let client: IClosableSupabaseClient;

    beforeAll(async () => {
      client = createSupabaseMockClient();
      const setup = await client.rpc("exec_sql", { query: SETUP_SQL });
      expect(setup.error).toBeNull();
    });

    afterAll(async () => {
      await client.close();
    });

    const newStore = () =>
      new SupabaseVectorStorage(
        client as unknown as ReturnType<typeof createClient>,
        "vec_items",
        VecSchema,
        VecPK,
        [],
        4
      );

    const scopedStore = () => newStore().withScope({ owner: "a" });

    it("persists scoped vectors and ranks by cosine similarity", async () => {
      const store = scopedStore();
      await store.put({
        id: "near",
        owner: "ignored",
        vector: mk({ 0: 1 }),
        metadata: { text: "near-text" },
      } as never);
      await store.put({
        id: "far",
        owner: "ignored",
        vector: mk({ 1: 1 }),
        metadata: { text: "far-text" },
      } as never);

      const results = await store.similaritySearch(mk({ 0: 1 }), { topK: 10 });
      expect(results.length).toBe(2);
      expect((results[0] as { id: string }).id).toBe("near");
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect((results[0] as { vector: unknown }).vector).toBeInstanceOf(Float32Array);
      expect((results[0] as { vector: Float32Array }).vector[0]).toBeCloseTo(1, 5);
    });

    it("stamps the resolved scope onto written rows (overriding client input)", async () => {
      const store = scopedStore();
      const results = await store.similaritySearch(mk({ 0: 1 }), { topK: 10 });
      for (const row of results) {
        expect((row as { owner: string }).owner).toBe("a");
      }
    });

    it("rejects unsafe metadata filter keys", async () => {
      const store = scopedStore();
      await expect(
        store.similaritySearch(mk({ 0: 1 }), { filter: { "bad-key": "x" } as never })
      ).rejects.toBeInstanceOf(StorageValidationError);
    });

    it("isolates rows by scope", async () => {
      const other = newStore().withScope({ owner: "b" });
      const results = await other.similaritySearch(mk({ 0: 1 }), { topK: 10 });
      expect(results.length).toBe(0);
    });

    it("scope-narrows inherited reads and deletes", async () => {
      const a = newStore().withScope({ owner: "a" });
      const all = (await a.getAll()) ?? [];
      expect(all.length).toBe(2);
      expect(all.every((r) => (r as { owner: string }).owner === "a")).toBe(true);

      // A different scope sees and clears only its own rows.
      const b = newStore().withScope({ owner: "b" });
      await b.put({ id: "b1", owner: "ignored", vector: mk({ 0: 1 }), metadata: {} } as never);
      await b.deleteAll();
      expect((await b.getAll()) ?? []).toHaveLength(0);
      // a's rows are untouched by b.deleteAll().
      expect((await a.getAll()) ?? []).toHaveLength(2);
    });

    it("operates table-wide when no scope is bound", async () => {
      const store = newStore();
      await store.put({
        id: "unscoped",
        owner: "z",
        vector: mk({ 2: 1 }),
        metadata: {},
      } as never);
      // Unscoped search filters on nothing, so it sees rows across owners.
      const results = await store.similaritySearch(mk({ 0: 1 }), { topK: 50 });
      const owners = new Set(results.map((r) => (r as { owner: string }).owner));
      expect(owners.has("a")).toBe(true);
      expect(owners.has("z")).toBe(true);
    });
  });
});
