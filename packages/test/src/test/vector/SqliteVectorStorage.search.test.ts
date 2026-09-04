/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite, SqliteVectorStorage } from "@workglow/sqlite/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
const DIM = 4;

/** Unit vectors, so a cosine score is exactly the coordinate it points along. */
const EAST = new Float32Array([1, 0, 0, 0]);
const NORTH = new Float32Array([0, 1, 0, 0]);
const NORTHEAST = new Float32Array([Math.SQRT1_2, Math.SQRT1_2, 0, 0]);

/**
 * `similaritySearch` end to end on a real SQLite database.
 *
 * The sibling validation suite only ever wrote and read back, which is why this
 * shipped broken: `similaritySearch` re-decoded a vector column the inherited
 * tabular read had already turned into a `Float32Array`, so `JSON.parse` threw
 * on the first row of every search. A store that accepts writes and fails every
 * query looks healthy from anywhere except a query.
 */
describe("SqliteVectorStorage similarity search", async () => {
  await Sqlite.init();

  let db: InstanceType<typeof Sqlite.Database>;
  let storage: SqliteVectorStorage<typeof VecSchema, typeof VecPK>;

  beforeEach(async () => {
    db = new Sqlite.Database(":memory:");
    storage = new SqliteVectorStorage(db, "vec_search", VecSchema, VecPK, [], DIM);
    await storage.setupDatabase();
    await storage.putBulk([
      { id: "east", vector: EAST, metadata: { region: "e" } },
      { id: "north", vector: NORTH, metadata: { region: "n" } },
      { id: "northeast", vector: NORTHEAST, metadata: { region: "ne" } },
    ] as never);
  });

  afterEach(async () => {
    await storage.deleteAll();
    db.close();
  });

  it("returns the stored rows, ranked by cosine similarity", async () => {
    const hits = await storage.similaritySearch(EAST);
    expect(hits.map((hit) => hit.id)).toEqual(["east", "northeast", "north"]);
    expect(hits[0]!.score).toBeCloseTo(1, 5);
    expect(hits[1]!.score).toBeCloseTo(Math.SQRT1_2, 5);
    expect(hits[2]!.score).toBeCloseTo(0, 5);
  });

  it("hands back the vector as a TypedArray, not the stored JSON", async () => {
    const [hit] = await storage.similaritySearch(EAST, { topK: 1 });
    expect(hit!.vector).toBeInstanceOf(Float32Array);
    expect([...(hit!.vector as Float32Array)]).toEqual([...EAST]);
  });

  it("honours topK", async () => {
    expect(await storage.similaritySearch(EAST, { topK: 2 })).toHaveLength(2);
  });

  it("honours scoreThreshold", async () => {
    const hits = await storage.similaritySearch(EAST, { scoreThreshold: 0.9 });
    expect(hits.map((hit) => hit.id)).toEqual(["east"]);
  });

  it("honours a metadata filter", async () => {
    const hits = await storage.similaritySearch(EAST, { filter: { region: "n" } });
    expect(hits.map((hit) => hit.id)).toEqual(["north"]);
  });

  it("searches rows written as raw JSON by an older release", async () => {
    // The column's stored form. A row that never round-tripped through this
    // class's writer must still be searchable, which is the other half of why
    // the decode accepts both shapes.
    db.prepare(`INSERT INTO vec_search (id, vector, metadata) VALUES (?, ?, ?)`).run(
      "legacy",
      JSON.stringify([...NORTH]),
      JSON.stringify({ region: "legacy" })
    );

    const hits = await storage.similaritySearch(NORTH, { topK: 2 });
    expect(hits.map((hit) => hit.id)).toContain("legacy");
  });

  it("emits the similaritySearch event with the results", async () => {
    let seen: readonly { id: string }[] | undefined;
    // The event belongs to the vector extension of the event surface; the
    // inherited `on` is typed to the tabular names, so cast at the call site.
    (
      storage as unknown as {
        on: (
          name: string,
          fn: (query: unknown, results: readonly { id: string }[]) => void
        ) => void;
      }
    ).on("similaritySearch", (_query, results) => {
      seen = results;
    });
    await storage.similaritySearch(EAST, { topK: 1 });
    expect(seen?.map((hit) => hit.id)).toEqual(["east"]);
  });
});
