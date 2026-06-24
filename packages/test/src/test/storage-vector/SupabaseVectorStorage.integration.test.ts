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

// A plain vector table + its `match_<table>` RPC. The base storage knows
// nothing of scoping — the RPC takes only the metadata `p_filter`.
const SETUP_SQL = `
  create extension if not exists vector;
  create table vec_items (
    id       text primary key,
    vector   vector(4) not null,
    metadata jsonb not null default '{}'::jsonb
  );
  create or replace function match_vec_items(
    query_embedding vector(4),
    match_count     int,
    score_threshold float,
    p_filter        jsonb
  )
  returns table (id text, vector vector(4), metadata jsonb, score float)
  language sql stable
  as $$
    select c.id, c.vector, c.metadata,
           (1 - (c.vector <=> query_embedding)) as score
    from vec_items c
    where c.metadata @> p_filter
      and (score_threshold is null or (1 - (c.vector <=> query_embedding)) >= score_threshold)
    order by c.vector <=> query_embedding
    limit match_count
  $$;
`;

const VecSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["id", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
const VecPK = ["id"] as const;

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

    it("persists vectors and ranks by cosine similarity", async () => {
      const store = newStore();
      await store.put({ id: "near", vector: mk({ 0: 1 }), metadata: { kind: "x" } } as never);
      await store.put({ id: "far", vector: mk({ 1: 1 }), metadata: { kind: "y" } } as never);

      const results = await store.similaritySearch(mk({ 0: 1 }), { topK: 10 });
      expect(results.length).toBe(2);
      expect((results[0] as { id: string }).id).toBe("near");
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect((results[0] as { vector: unknown }).vector).toBeInstanceOf(Float32Array);
      expect((results[0] as { vector: Float32Array }).vector[0]).toBeCloseTo(1, 5);
    });

    it("filters by metadata containment", async () => {
      const store = newStore();
      const results = await store.similaritySearch(mk({ 0: 1 }), {
        topK: 10,
        filter: { kind: "x" } as never,
      });
      expect(results.length).toBe(1);
      expect((results[0] as { id: string }).id).toBe("near");
    });

    it("defaults a missing metadata column to {}", async () => {
      const store = newStore();
      await store.put({ id: "no-meta", vector: mk({ 2: 1 }) } as never);
      const stored = await store.get({ id: "no-meta" } as never);
      expect((stored as { metadata: unknown }).metadata).toEqual({});
    });

    it("rejects unsafe metadata filter keys", async () => {
      const store = newStore();
      await expect(
        store.similaritySearch(mk({ 0: 1 }), { filter: { "bad-key": "x" } as never })
      ).rejects.toBeInstanceOf(StorageValidationError);
    });
  });
});
