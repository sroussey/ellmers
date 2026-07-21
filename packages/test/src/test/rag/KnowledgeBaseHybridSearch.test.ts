/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createKnowledgeBase } from "@workglow/knowledge-base";
import { BM25Index } from "@workglow/storage";
import type { ILogger } from "@workglow/util";
import { getLogger, NullLogger, setLogger, uuid4 } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

import { report, snap } from "../../binding/testTiming";

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
    const s = snap();
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      register: false,
    });
    expect(kb.supportsHybridSearch()).toBe(false);
    await expect(kb.hybridSearch(vec(1, 0, 0), { textQuery: "rabbit", topK: 5 })).rejects.toThrow(
      /text index/i
    );
    report("hybrid: throws-no-index", s);
  });

  it("auto-indexes text fields on upsertChunk and exposes them via textSearch", async () => {
    const s = snap();
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
    report("hybrid: auto-index", s);
  });

  it("deleteDocument cascades to the text index", async () => {
    const s = snap();
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
    report("hybrid: delete-cascade", s);
  });

  it("clearChunks empties the text index", async () => {
    const s = snap();
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
    report("hybrid: clear-chunks", s);
  });

  it("RRF surfaces a chunk that ranks high in text but only mid-pack in vector", async () => {
    const s = snap();
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
    report("hybrid: rrf-promotion", s);
  });

  it("hybridSearch returns an empty array when the index has no chunks", async () => {
    const s = snap();
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
    report("hybrid: empty-index", s);
  });

  it("upserting a chunk with empty text drops its postings from the index", async () => {
    const s = snap();
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
    report("hybrid: empty-text-drop", s);
  });

  it("put / putBulk go through the indexing path (alias for upsertChunk*)", async () => {
    const s = snap();
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
    report("hybrid: put-alias", s);
  });

  it("hybridSearch tolerates fractional candidatePoolMultiplier (integer poolSize)", async () => {
    const s = snap();
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
    report("hybrid: fractional-pool", s);
  });

  it("installTextIndex after upserts requires reindexText to populate", async () => {
    const s = snap();
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
    report("hybrid: reindex", s);
  });

  it("reindexText rolls back on synchronous index.add failure (truly atomic)", async () => {
    const s = snap();
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
    report("hybrid: reindex-rollback", s);
  });

  it("upsertChunk routes its index-write warning through the logger, not console", async () => {
    const s = snap();
    const warnings: string[] = [];
    const capturing: ILogger = Object.assign(new NullLogger(), {
      warn(message: string): void {
        warnings.push(message);
      },
    });
    const previousLogger = getLogger();
    const originalConsoleWarn = console.warn;
    let consoleWarnCalls = 0;
    console.warn = ((...args: unknown[]) => {
      consoleWarnCalls += 1;
      return originalConsoleWarn.apply(console, args as []);
    }) as typeof console.warn;
    setLogger(capturing);
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
      // The warning was emitted through the structured logger, naming the chunk.
      expect(warnings.some((m) => m.includes("c1"))).toBe(true);
      // And it did NOT reach console.warn directly.
      expect(consoleWarnCalls).toBe(0);
    } finally {
      console.warn = originalConsoleWarn;
      setLogger(previousLogger);
    }
    report("hybrid: index-warn", s);
  });

  it("reindexText is atomic: a chunkStorage failure leaves the existing index untouched", async () => {
    const s = snap();
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
    report("hybrid: reindex-atomic", s);
  });

  it("hybridSearch falls back to similaritySearch when textQuery is empty", async () => {
    const s = snap();
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
    report("hybrid: empty-query-fallback", s);
  });

  it("hybridSearch clamps negative rrfK to a safe value (no Infinity scores)", async () => {
    const s = snap();
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
    report("hybrid: clamp-rrfK", s);
  });

  it("attaches scoreType to results for each search method", async () => {
    const s = snap();
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
    report("hybrid: score-type", s);
  });

  it("hybridSearch produces RRF-shaped scores (small positives, not cosine)", async () => {
    const s = snap();
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
    report("hybrid: rrf-scores", s);
  });
});
