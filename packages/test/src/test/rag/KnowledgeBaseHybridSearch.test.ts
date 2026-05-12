/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createKnowledgeBase } from "@workglow/knowledge-base";
import { BM25Index } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

type MemSnapshot = ReturnType<typeof process.memoryUsage>;
const mb = (n: number) => (n / 1024 / 1024).toFixed(0) + "MB";
const signedMb = (n: number) => (n >= 0 ? "+" : "") + (n / 1024 / 1024).toFixed(0) + "MB";
const snapMem = (): MemSnapshot => process.memoryUsage();
const reportMem = (label: string, start?: MemSnapshot) => {
  const m = process.memoryUsage();
  const fmt = (cur: number, base: number | undefined) =>
    base === undefined ? mb(cur) : `${mb(cur)} (${signedMb(cur - base)})`;
  process.stderr.write(
    `[${label}] MEM rss=${fmt(m.rss, start?.rss)} heap=${fmt(m.heapUsed, start?.heapUsed)} ext=${fmt(m.external, start?.external)} ab=${fmt(m.arrayBuffers, start?.arrayBuffers)}\n`
  );
};
const reportTime = (label: string, started: number) => {
  process.stderr.write(`[${label}] TIME ${((Date.now() - started) / 1000).toFixed(2)}s\n`);
};

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
  let kbName: string;

  beforeEach(() => {
    kbName = `hybrid-test-${uuid4()}`;
  });

  it("hybridSearch throws when no text index is installed", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      register: false,
    });
    expect(kb.supportsHybridSearch()).toBe(false);
    await expect(
      kb.hybridSearch(vec(1, 0, 0), { textQuery: "rabbit", topK: 5 })
    ).rejects.toThrow(/text index/i);
    reportTime("hybrid: throws-no-index", started);
    reportMem("hybrid: throws-no-index", startMem);
  });

  it("auto-indexes text fields on upsertChunk and exposes them via textSearch", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
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
    reportTime("hybrid: auto-index", started);
    reportMem("hybrid: auto-index", startMem);
  });

  it("deleteDocument cascades to the text index", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)));
    await kb.upsertChunk(makeChunk("c2", "d2", "fox", vec(0, 1, 0)));
    expect(index.size()).toBe(2);

    await kb.deleteDocument("d1");
    expect(index.size()).toBe(1);
    expect(await kb.textSearch("rabbit")).toEqual([]);
    const foxHits = await kb.textSearch("fox");
    expect(foxHits.map((r) => r.chunk_id)).toEqual(["c2"]);
    reportTime("hybrid: delete-cascade", started);
    reportMem("hybrid: delete-cascade", startMem);
  });

  it("clearChunks empties the text index", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));
    expect(index.size()).toBe(1);

    await kb.clearChunks();
    expect(index.size()).toBe(0);
    expect(await kb.textSearch("rabbit")).toEqual([]);
    reportTime("hybrid: clear-chunks", started);
    reportMem("hybrid: clear-chunks", startMem);
  });

  it("RRF surfaces a chunk that ranks high in text but only mid-pack in vector", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
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
    reportTime("hybrid: rrf-promotion", started);
    reportMem("hybrid: rrf-promotion", startMem);
  });

  it("hybridSearch returns an empty array when the index has no chunks", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: new BM25Index(),
      register: false,
    });
    const results = await kb.hybridSearch(vec(1, 0, 0), {
      textQuery: "rabbit",
      topK: 5,
    });
    expect(results).toEqual([]);
    reportTime("hybrid: empty-index", started);
    reportMem("hybrid: empty-index", startMem);
  });

  it("upserting a chunk with empty text drops its postings from the index", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
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
    reportTime("hybrid: empty-text-drop", started);
    reportMem("hybrid: empty-text-drop", startMem);
  });

  it("put / putBulk go through the indexing path (alias for upsertChunk*)", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
    });

    await kb.put(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));
    await kb.putBulk([
      makeChunk("c2", "d2", "fox garden", vec(0, 1, 0)),
      makeChunk("c3", "d3", "tomato vine", vec(0, 0, 1)),
    ]);

    expect(index.size()).toBe(3);
    const hits = await kb.textSearch("rabbit");
    expect(hits.map((r) => r.chunk_id)).toEqual(["c1"]);
    reportTime("hybrid: put-alias", started);
    reportMem("hybrid: put-alias", startMem);
  });

  it("hybridSearch tolerates fractional candidatePoolMultiplier (integer poolSize)", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
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
    reportTime("hybrid: fractional-pool", started);
    reportMem("hybrid: fractional-pool", startMem);
  });

  it("installTextIndex after upserts requires reindexText to populate", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      register: false,
    });
    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));

    const index = new BM25Index();
    kb.installTextIndex(index);
    // Pre-existing chunks aren't auto-indexed; reindex picks them up.
    expect(index.size()).toBe(0);
    await kb.reindexText();
    expect(index.size()).toBe(1);
    const hits = await kb.textSearch("rabbit");
    expect(hits[0].chunk_id).toBe("c1");
    reportTime("hybrid: reindex", started);
    reportMem("hybrid: reindex", startMem);
  });

  it("reindexText rolls back on synchronous index.add failure (truly atomic)", async () => {
    const started = Date.now();
    const startMem = snapMem();
    // Custom ITextIndex whose `add` throws on a sentinel doc id; verifies the
    // snapshot/rollback path in reindexText().
    let addCount = 0;
    const stub = {
      _state: new Map<string, { docId: string; fields: unknown }>(),
      add(chunkId: string, docId: string, fields: unknown) {
        addCount += 1;
        if (docId === "trigger-throw") {
          throw new Error("boom");
        }
        this._state.set(chunkId, { docId, fields });
      },
      remove(chunkId: string) {
        this._state.delete(chunkId);
      },
      removeByDocument() {},
      clear() {
        this._state.clear();
      },
      size() {
        return this._state.size;
      },
      search() {
        return [];
      },
      toJSON() {
        return { snap: Array.from(this._state.entries()) };
      },
      fromJSON(s: unknown) {
        const snap = (s as { snap: Array<[string, { docId: string; fields: unknown }]> }).snap;
        this._state = new Map(snap);
      },
    };

    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: stub as unknown as InstanceType<typeof BM25Index>,
      register: false,
    });
    // Seed two chunks under safe doc ids; the index now has 2 entries.
    await kb.upsertChunksBulk([
      makeChunk("c1", "safe-doc", "rabbit", vec(1, 0, 0)),
      makeChunk("c2", "safe-doc", "fox", vec(0, 1, 0)),
    ]);
    expect(stub.size()).toBe(2);
    const sizeBefore = stub.size();
    addCount = 0;

    // Inject a chunk under the trigger doc id directly into chunk storage
    // (bypassing the KB upsert path so we don't hit the auto-index warn).
    await kb.vectorStorage.put(makeChunk("c3", "trigger-throw", "vine", vec(0, 0, 1)));

    await expect(kb.reindexText()).rejects.toThrow(/boom/);
    // Add was called at least once before the throw; rollback must restore.
    expect(addCount).toBeGreaterThan(0);
    expect(stub.size()).toBe(sizeBefore);
    reportTime("hybrid: reindex-rollback", started);
    reportMem("hybrid: reindex-rollback", startMem);
  });

  it("upsertChunk surfaces a warning when textIndex.add throws but keeps the chunk", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const errors: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => errors.push(msg);
    try {
      const stub = {
        add() {
          throw new Error("index unavailable");
        },
        remove() {},
        removeByDocument() {},
        clear() {},
        size() {
          return 0;
        },
        search() {
          return [];
        },
        toJSON() {
          return {};
        },
        fromJSON() {},
      };
      const kb = await createKnowledgeBase({
        name: kbName,
        vectorDimensions: dimensions,
        textIndex: stub as unknown as InstanceType<typeof BM25Index>,
        register: false,
      });
      const stored = await kb.upsertChunk(makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)));
      // Chunk is in the vector store even though the index write failed.
      expect(stored.chunk_id).toBe("c1");
      expect(await kb.getChunk("c1")).toBeDefined();
      // And a warning was emitted naming the chunk.
      expect(errors.some((m) => m.includes("c1"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
    reportTime("hybrid: index-warn", started);
    reportMem("hybrid: index-warn", startMem);
  });

  it("reindexText is atomic: a chunkStorage failure leaves the existing index untouched", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
    });
    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));
    expect(index.size()).toBe(1);

    // Force getAll() to throw. If reindexText() were non-atomic (clear-then-load),
    // the index would be left empty after this throw.
    const original = kb.vectorStorage.getAll.bind(kb.vectorStorage);
    kb.vectorStorage.getAll = () => Promise.reject(new Error("backend gone"));

    await expect(kb.reindexText()).rejects.toThrow(/backend gone/);
    expect(index.size()).toBe(1);
    const hits = await kb.textSearch("rabbit");
    expect(hits.map((r) => r.chunk_id)).toEqual(["c1"]);

    // Restore so the destroy() in afterEach behaves.
    kb.vectorStorage.getAll = original;
    reportTime("hybrid: reindex-atomic", started);
    reportMem("hybrid: reindex-atomic", startMem);
  });

  it("hybridSearch falls back to similaritySearch when textQuery is empty", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
    });
    await kb.upsertChunksBulk([
      makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)),
      makeChunk("c2", "d2", "fox", vec(0, 1, 0)),
    ]);

    const empty = await kb.hybridSearch(vec(1, 0, 0), { textQuery: "", topK: 2 });
    const whitespace = await kb.hybridSearch(vec(1, 0, 0), { textQuery: "   ", topK: 2 });
    const cosine = await kb.similaritySearch(vec(1, 0, 0), { topK: 2 });

    // Empty / whitespace query path returns cosine scores, identical ordering.
    expect(empty.map((r) => r.chunk_id)).toEqual(cosine.map((r) => r.chunk_id));
    expect(whitespace.map((r) => r.chunk_id)).toEqual(cosine.map((r) => r.chunk_id));
    // And cosine scores are in [0,1], unlike the small RRF range.
    expect(empty[0].score).toBeGreaterThan(0.5);
    reportTime("hybrid: empty-query-fallback", started);
    reportMem("hybrid: empty-query-fallback", startMem);
  });

  it("hybridSearch clamps negative rrfK to a safe value (no Infinity scores)", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
    });
    await kb.upsertChunksBulk([
      makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)),
      makeChunk("c2", "d2", "rabbit fence", vec(0, 1, 0)),
    ]);

    // rrfK = -10 would otherwise produce Infinity / negative denominators.
    const results = await kb.hybridSearch(vec(1, 0, 0), {
      textQuery: "rabbit",
      topK: 2,
      rrfK: -10,
    });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThan(0);
    }
    reportTime("hybrid: clamp-rrfK", started);
    reportMem("hybrid: clamp-rrfK", startMem);
  });

  it("attaches scoreType to results for each search method", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
    });
    await kb.upsertChunksBulk([
      makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)),
      makeChunk("c2", "d2", "rabbit fence", vec(0, 1, 0)),
    ]);

    const sim = await kb.similaritySearch(vec(1, 0, 0), { topK: 2 });
    const text = await kb.textSearch("rabbit", { topK: 2 });
    const hybrid = await kb.hybridSearch(vec(1, 0, 0), { textQuery: "rabbit", topK: 2 });
    const hybridEmpty = await kb.hybridSearch(vec(1, 0, 0), { textQuery: "", topK: 2 });

    expect(sim.every((r) => r.scoreType === "cosine")).toBe(true);
    expect(text.every((r) => r.scoreType === "bm25")).toBe(true);
    expect(hybrid.every((r) => r.scoreType === "rrf")).toBe(true);
    // Empty-query fallback routes through similaritySearch, so cosine.
    expect(hybridEmpty.every((r) => r.scoreType === "cosine")).toBe(true);
    reportTime("hybrid: score-type", started);
    reportMem("hybrid: score-type", startMem);
  });

  it("hybridSearch produces RRF-shaped scores (small positives, not cosine)", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const index = new BM25Index();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex: index,
      register: false,
    });
    await kb.upsertChunksBulk([
      makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)),
      makeChunk("c2", "d2", "fox", vec(0, 1, 0)),
    ]);

    const results = await kb.hybridSearch(vec(1, 0, 0), { textQuery: "rabbit", topK: 2 });
    expect(results.length).toBeGreaterThan(0);
    // RRF default rrfK=60, so the top contribution is at most 1/(60+1) ≈ 0.0164.
    // Sum across two rankers (vectorWeight + textWeight = 1) caps at ~0.0164.
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThan(0.05);
    }
    reportTime("hybrid: rrf-scores", started);
    reportMem("hybrid: rrf-scores", startMem);
  });
});
