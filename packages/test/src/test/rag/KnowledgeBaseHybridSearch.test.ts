/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createKnowledgeBase } from "@workglow/knowledge-base";
import { BM25Index } from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const dimensions = 3;

const vec = (a: number, b: number, c: number) => new Float32Array([a, b, c]);

const makeChunk = (
  chunk_id: string,
  doc_id: string,
  text: string,
  vector: Float32Array,
  extras: Partial<Record<string, unknown>> = {}
) => ({
  chunk_id,
  doc_id,
  vector,
  metadata: { chunkId: chunk_id, doc_id, text, nodePath: [chunk_id], depth: 0, ...extras },
});

describe("KnowledgeBase hybrid search (RRF over vector + BM25)", () => {
  let kbCounter = 0;
  let kbName: string;

  beforeEach(() => {
    kbCounter += 1;
    kbName = `hybrid-test-${kbCounter}-${Date.now()}`;
  });

  afterEach(() => {
    // KBs are auto-registered; nothing to tear down explicitly for in-memory.
  });

  it("hybridSearch throws when no text index is installed", async () => {
    const kb = await createKnowledgeBase({ name: kbName, vectorDimensions: dimensions });
    expect(kb.supportsHybridSearch()).toBe(false);
    await expect(
      kb.hybridSearch(vec(1, 0, 0), { textQuery: "rabbit", topK: 5 })
    ).rejects.toThrow(/text index/i);
  });

  it("auto-indexes text fields on upsertChunk and exposes them via textSearch", async () => {
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "the rabbit jumps over the fence", vec(1, 0, 0)));
    await kb.upsertChunk(makeChunk("c2", "d2", "the fox eats grapes", vec(0, 1, 0)));

    expect(kb.supportsHybridSearch()).toBe(true);
    expect(index.size()).toBe(2);

    const results = await kb.textSearch("rabbit");
    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe("c1");
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].metadata.text).toContain("rabbit");
  });

  it("deleteDocument cascades to the text index", async () => {
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)));
    await kb.upsertChunk(makeChunk("c2", "d2", "fox", vec(0, 1, 0)));
    expect(index.size()).toBe(2);

    await kb.deleteDocument("d1");
    expect(index.size()).toBe(1);
    expect(await kb.textSearch("rabbit")).toEqual([]);
    const foxHits = await kb.textSearch("fox");
    expect(foxHits.map((r) => r.chunk_id)).toEqual(["c2"]);
  });

  it("clearChunks empties the text index", async () => {
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));
    expect(index.size()).toBe(1);

    await kb.clearChunks();
    expect(index.size()).toBe(0);
    expect(await kb.textSearch("rabbit")).toEqual([]);
  });

  it("RRF surfaces a chunk that ranks high in text but only mid-pack in vector", async () => {
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
    });

    // Query vector aligned with axis x. c1 is the closest vector match but
    // contains no relevant text. c2 has perfect text match but a mediocre
    // vector. Pure vector search ranks c1 first; RRF fusion should promote c2.
    await kb.upsertChunksBulk([
      makeChunk("c1", "d1", "unrelated content about gardens", vec(1.0, 0.0, 0.0)),
      makeChunk("c2", "d2", "rabbit and fence and rabbit", vec(0.5, 0.5, 0.0), {
        doc_title: "Rabbits",
      }),
      makeChunk("c3", "d3", "completely different topic", vec(0.0, 1.0, 0.0)),
    ]);

    // Pure vector search: c1 wins.
    const vectorOnly = await kb.similaritySearch(vec(1, 0, 0), { topK: 3 });
    expect(vectorOnly[0].chunk_id).toBe("c1");

    // Hybrid with text-leaning weight: c2's text match should win after RRF.
    const fused = await kb.hybridSearch(vec(1, 0, 0), {
      textQuery: "rabbit",
      topK: 3,
      vectorWeight: 0.3,
    });
    expect(fused[0].chunk_id).toBe("c2");
  });

  it("hybridSearch returns an empty array when the index has no chunks", async () => {
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: new BM25Index(),
    });
    const results = await kb.hybridSearch(vec(1, 0, 0), {
      textQuery: "rabbit",
      topK: 5,
    });
    expect(results).toEqual([]);
  });

  it("upserting a chunk with empty text drops its postings from the index", async () => {
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));
    expect(index.size()).toBe(1);

    // Re-upsert the same chunk with no indexable text — old postings must go.
    await kb.upsertChunk({
      chunk_id: "c1",
      doc_id: "d1",
      vector: vec(1, 0, 0),
      metadata: { chunkId: "c1", doc_id: "d1", text: "", nodePath: ["c1"], depth: 0 },
    });
    expect(index.size()).toBe(0);
    expect(await kb.textSearch("rabbit")).toEqual([]);
  });

  it("put / putBulk go through the indexing path (alias for upsertChunk*)", async () => {
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
    });

    await kb.put(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));
    await kb.putBulk([
      makeChunk("c2", "d2", "fox garden", vec(0, 1, 0)),
      makeChunk("c3", "d3", "tomato vine", vec(0, 0, 1)),
    ]);

    expect(index.size()).toBe(3);
    const hits = await kb.textSearch("rabbit");
    expect(hits.map((r) => r.chunk_id)).toEqual(["c1"]);
  });

  it("hybridSearch tolerates fractional candidatePoolMultiplier (integer poolSize)", async () => {
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
    });

    await kb.upsertChunksBulk([
      makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)),
      makeChunk("c2", "d2", "rabbit fence", vec(0, 1, 0)),
      makeChunk("c3", "d3", "rabbit garden", vec(0, 0, 1)),
    ]);

    // 3 * 1.7 = 5.1 — must not propagate as a non-integer topK.
    const results = await kb.hybridSearch(vec(1, 0, 0), {
      textQuery: "rabbit",
      topK: 3,
      candidatePoolMultiplier: 1.7,
    });
    expect(results).toHaveLength(3);
  });

  it("installTextIndex after upserts requires reindexText to populate", async () => {
    const kb = await createKnowledgeBase({ name: kbName, vectorDimensions: dimensions });
    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));

    const index = new BM25Index();
    kb.installTextIndex(index);
    // Pre-existing chunks aren't auto-indexed; reindex picks them up.
    expect(index.size()).toBe(0);
    await kb.reindexText();
    expect(index.size()).toBe(1);
    const hits = await kb.textSearch("rabbit");
    expect(hits[0].chunk_id).toBe("c1");
  });
});
