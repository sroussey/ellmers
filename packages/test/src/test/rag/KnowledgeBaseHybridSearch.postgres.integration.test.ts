/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { PostgresFtsTextIndex } from "@workglow/postgres/text";
import { uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

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

let _started = 0;
let _startMem: MemSnapshot;
beforeEach(() => {
  _started = Date.now();
  _startMem = snapMem();
});
afterEach((ctx) => {
  reportTime(`hybrid-pg: ${ctx.task.name}`, _started);
  reportMem(`hybrid-pg: ${ctx.task.name}`, _startMem);
});

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

const db = new PGlite() as unknown as Pool;

describe("KnowledgeBase hybrid search backed by PostgresFtsTextIndex", () => {
  let kbName: string;
  let textIndex: PostgresFtsTextIndex;

  beforeEach(async () => {
    kbName = `hybrid-pg-${uuid4()}`;
    const table = `fts_kb_${uuid4().replace(/-/g, "_")}`;
    textIndex = new PostgresFtsTextIndex(db, table);
    await textIndex.setupDatabase();
  });

  afterAll(async () => {
    reportMem("hybrid-pg before dispose");
    const beforeDispose = snapMem();
    await (db as unknown as PGlite).close();
    reportMem("hybrid-pg after dispose", beforeDispose);
  });

  it("auto-indexes text fields on upsertChunk and exposes them via textSearch", async () => {
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex,
      register: false,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "the rabbit jumps over the fence", vec(1, 0, 0)));
    await kb.upsertChunk(makeChunk("c2", "d2", "the fox eats grapes", vec(0, 1, 0)));

    expect(kb.supportsHybridSearch()).toBe(true);
    expect(await textIndex.size()).toBe(2);

    const results = await kb.textSearch("rabbit");
    expect(results.map((r) => r.chunk_id)).toEqual(["c1"]);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("RRF promotes a chunk that ranks high in Postgres FTS over a mid-pack vector hit", async () => {
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex,
      register: false,
    });

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

    // RRF is rank-based — we assert the order of chunk_ids, not exact scores
    // (Postgres ts_rank_cd values are not portable across configurations).
    const fused = await kb.hybridSearch(vec(1, 0, 0), {
      textQuery: "rabbit",
      topK: 3,
      vectorWeight: 0.3,
    });
    expect(fused[0].chunk_id).toBe("c2");
  });

  it("deleteDocument cascades to the Postgres FTS index", async () => {
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex,
      register: false,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)));
    await kb.upsertChunk(makeChunk("c2", "d2", "fox", vec(0, 1, 0)));
    expect(await textIndex.size()).toBe(2);

    await kb.deleteDocument("d1");
    expect(await textIndex.size()).toBe(1);
    expect(await kb.textSearch("rabbit")).toEqual([]);
    const foxHits = await kb.textSearch("fox");
    expect(foxHits.map((r) => r.chunk_id)).toEqual(["c2"]);
  });

  it("clearChunks empties the Postgres FTS index", async () => {
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex,
      register: false,
    });

    await kb.upsertChunk(makeChunk("c1", "d1", "rabbit fence", vec(1, 0, 0)));
    expect(await textIndex.size()).toBe(1);

    await kb.clearChunks();
    expect(await textIndex.size()).toBe(0);
    expect(await kb.textSearch("rabbit")).toEqual([]);
  });

  it("reindexText rebuilds the Postgres FTS table from chunk storage", async () => {
    const kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: dimensions,
      textIndex,
      register: false,
    });

    await kb.upsertChunksBulk([
      makeChunk("c1", "d1", "rabbit", vec(1, 0, 0)),
      makeChunk("c2", "d2", "fence", vec(0, 1, 0)),
    ]);
    expect(await textIndex.size()).toBe(2);

    // Drop the FTS state out-of-band, then ask the KB to rebuild it.
    await textIndex.clear();
    expect(await textIndex.size()).toBe(0);

    await kb.reindexText();
    expect(await textIndex.size()).toBe(2);
    expect((await kb.textSearch("rabbit")).map((r) => r.chunk_id)).toEqual(["c1"]);
  });
});
