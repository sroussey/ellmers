/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresFtsTextIndex } from "@workglow/postgres/text";
import { uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite() as unknown as Pool;

describe("PostgresFtsTextIndex", () => {
  let table: string;
  let index: PostgresFtsTextIndex;

  beforeAll(async () => {
    table = `fts_test_${uuid4().replace(/-/g, "_")}`;
    index = new PostgresFtsTextIndex(db, table);
    await index.setupDatabase();
  });

  afterAll(async () => {
    await (db as unknown as PGlite).close();
  });

  async function reset(): Promise<void> {
    await index.clear();
  }

  it("add then search returns matching chunkId with non-zero rank-ordered score", async () => {
    await reset();
    await index.add("c1", "d1", { text: "the rabbit jumps over the fence" });
    await index.add("c2", "d2", { text: "the fox eats grapes" });

    const results = await index.search("rabbit");
    expect(results.map((r) => r.chunkId)).toEqual(["c1"]);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("remove(chunkId) drops postings", async () => {
    await reset();
    await index.add("c1", "d1", { text: "rabbit fence garden" });
    await index.add("c2", "d1", { text: "wombat hops" });
    expect(await index.size()).toBe(2);

    await index.remove("c1");
    expect(await index.size()).toBe(1);
    expect(await index.search("rabbit")).toEqual([]);
  });

  it("removeByDocument(docId) drops all chunks for the document", async () => {
    await reset();
    await index.add("c1", "doc-a", { text: "rabbit" });
    await index.add("c2", "doc-a", { text: "fence" });
    await index.add("c3", "doc-b", { text: "wombat" });
    expect(await index.size()).toBe(3);

    await index.removeByDocument("doc-a");
    expect(await index.size()).toBe(1);
    expect(await index.search("rabbit")).toEqual([]);
    expect((await index.search("wombat")).map((r) => r.chunkId)).toEqual(["c3"]);
  });

  it("clear() empties the index", async () => {
    await reset();
    await index.add("c1", "d1", { text: "rabbit" });
    await index.add("c2", "d2", { text: "fence" });
    expect(await index.size()).toBe(2);

    await index.clear();
    expect(await index.size()).toBe(0);
    expect(await index.search("rabbit")).toEqual([]);
  });

  it("search with topK respects the limit and orders by ts_rank_cd descending", async () => {
    await reset();
    // Each chunk gets the term once in `text`, plus a different distribution
    // of weighted fields. The rank ordering should track field-weight buckets:
    //   `text` is bucket A, `doc_title` is B, `summary` is C, so a chunk that
    //   also has `text` repeated should outrank one with only one A occurrence.
    await index.add("rare-strong", "d1", {
      text: "rabbit rabbit rabbit",
    });
    await index.add("rare-weak", "d2", {
      summary: "rabbit",
    });
    await index.add("noise", "d3", {
      text: "fence garden lawn",
    });

    const results = await index.search("rabbit", { topK: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results[0].chunkId).toBe("rare-strong");
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
    // The `noise` chunk shouldn't appear at all.
    expect(results.map((r) => r.chunkId)).not.toContain("noise");
  });

  it("array-valued fields are tokenised after space-joining", async () => {
    await reset();
    await index.add("c1", "d1", {
      sectionTitles: ["chapter one", "the wombat returns"],
    });
    const results = await index.search("wombat");
    expect(results.map((r) => r.chunkId)).toEqual(["c1"]);
  });

  it("beginRebuild/commitRebuild round-trip leaves index empty when no chunks are added", async () => {
    await reset();
    await index.add("c1", "d1", { text: "rabbit" });

    await index.beginRebuild();
    await index.clear();
    // No add() calls — simulating a reindex over an empty corpus.
    await index.commitRebuild();

    expect(await index.size()).toBe(0);
    expect(await index.search("rabbit")).toEqual([]);
  });

  it("abortRebuild restores pre-rebuild state", async () => {
    await reset();
    await index.add("c1", "d1", { text: "the original rabbit" });
    expect(await index.size()).toBe(1);

    await index.beginRebuild();
    await index.clear();
    await index.add("c2", "d2", { text: "the doomed wombat" });
    await index.abortRebuild();

    // Rollback should have undone both the clear and the doomed add.
    expect(await index.size()).toBe(1);
    const results = await index.search("rabbit");
    expect(results.map((r) => r.chunkId)).toEqual(["c1"]);
    expect(await index.search("wombat")).toEqual([]);
  });

  it("empty query returns an empty result set without touching the database", async () => {
    await reset();
    await index.add("c1", "d1", { text: "rabbit" });
    expect(await index.search("")).toEqual([]);
    expect(await index.search("   ")).toEqual([]);
  });

  it("add with no indexable text removes prior postings for the chunk", async () => {
    await reset();
    await index.add("c1", "d1", { text: "rabbit" });
    expect((await index.search("rabbit")).map((r) => r.chunkId)).toEqual(["c1"]);

    await index.add("c1", "d1", { text: "" });
    expect(await index.search("rabbit")).toEqual([]);
  });
});
