/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { chunkRetrieval } from "@workglow/ai";
import {
  createKnowledgeBase,
  KnowledgeBase,
  registerKnowledgeBase,
} from "@workglow/knowledge-base";
import { setLogger, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

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

describe("ChunkRetrievalTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let kb: KnowledgeBase;

  beforeEach(async () => {
    kb = await createKnowledgeBase({
      name: `retrieval-test-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });

    // Populate with test data
    const vectors = [
      new Float32Array([1.0, 0.0, 0.0]),
      new Float32Array([0.8, 0.2, 0.0]),
      new Float32Array([0.0, 1.0, 0.0]),
      new Float32Array([0.0, 0.0, 1.0]),
      new Float32Array([0.9, 0.1, 0.0]),
    ];

    const metadata = [
      { chunkId: "doc1_0", doc_id: "doc1", text: "First chunk about AI", nodePath: [], depth: 0 },
      {
        chunkId: "doc2_0",
        doc_id: "doc2",
        text: "Second chunk about machine learning",
        nodePath: [],
        depth: 0,
      },
      {
        chunkId: "doc3_0",
        doc_id: "doc3",
        text: "Third chunk about cooking",
        nodePath: [],
        depth: 0,
      },
      {
        chunkId: "doc4_0",
        doc_id: "doc4",
        text: "Fourth chunk about travel",
        nodePath: [],
        depth: 0,
      },
      {
        chunkId: "doc5_0",
        doc_id: "doc5",
        text: "Fifth chunk about artificial intelligence",
        nodePath: [],
        depth: 0,
      },
    ];

    for (let i = 0; i < vectors.length; i++) {
      const doc_id = `doc${i + 1}`;
      await kb.upsertChunk({
        chunk_id: `${doc_id}_0`,
        doc_id,
        vector: vectors[i],
        metadata: metadata[i],
      });
    }
  });

  afterEach(() => {
    kb.destroy();
  });

  test("should retrieve chunks with query vector", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 3,
    });

    expect(result.count).toBe(3);
    expect(result.chunks).toHaveLength(3);
    expect(result.chunk_ids).toHaveLength(3);
    expect(result.metadata).toHaveLength(3);
    expect(result.scores).toHaveLength(3);

    // Chunks should be extracted from metadata
    expect(result.chunks[0]).toBeTruthy();
    expect(typeof result.chunks[0]).toBe("string");
    reportTime("chunk-retrieval: query-vector", started);
    reportMem("chunk-retrieval: query-vector", startMem);
  });

  test("should extract text from metadata.text field", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 5,
    });

    // Find chunks that have text field
    const textChunks = result.chunks.filter((chunk, idx) => {
      const meta = result.metadata[idx];
      return meta.text !== undefined;
    });

    expect(textChunks.length).toBeGreaterThan(0);
    textChunks.forEach((chunk, idx) => {
      const originalIdx = result.chunks.indexOf(chunk);
      expect(chunk).toBe(result.metadata[originalIdx].text);
    });
    reportTime("chunk-retrieval: extract-text", started);
    reportMem("chunk-retrieval: extract-text", startMem);
  });

  test("should return vectors when returnVectors is true", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 3,
      returnVectors: true,
    });

    expect(result.vectors).toBeDefined();
    expect(result.vectors).toHaveLength(3);
    expect(result.vectors![0]).toBeInstanceOf(Float32Array);
    reportTime("chunk-retrieval: return-vectors", started);
    reportMem("chunk-retrieval: return-vectors", startMem);
  });

  test("should not return vectors when returnVectors is false", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 3,
      returnVectors: false,
    });

    expect(result.vectors).toBeUndefined();
    reportTime("chunk-retrieval: no-vectors", started);
    reportMem("chunk-retrieval: no-vectors", startMem);
  });

  test("should respect topK parameter", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 2,
    });

    expect(result.count).toBe(2);
    expect(result.chunks).toHaveLength(2);
    reportTime("chunk-retrieval: topK", started);
    reportMem("chunk-retrieval: topK", startMem);
  });

  test("should apply score threshold", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 10,
      scoreThreshold: 0.9,
    });

    result.scores.forEach((score) => {
      expect(score).toBeGreaterThanOrEqual(0.9);
    });
    reportTime("chunk-retrieval: score-threshold", started);
    reportMem("chunk-retrieval: score-threshold", startMem);
  });

  test("should throw error when query is string without model", async () => {
    const started = Date.now();
    const startMem = snapMem();
    await expect(
      // @ts-expect-error - query is string but no model is provided
      chunkRetrieval({
        knowledgeBase: kb,
        query: "test query string",
        topK: 3,
      })
    ).rejects.toThrow("model");
    reportTime("chunk-retrieval: throw-no-model", started);
    reportMem("chunk-retrieval: throw-no-model", startMem);
  });

  test("should handle default topK value", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
    });

    // Default topK is 5
    expect(result.count).toBe(5);
    expect(result.count).toBeLessThanOrEqual(5);
    reportTime("chunk-retrieval: default-topK", started);
    reportMem("chunk-retrieval: default-topK", startMem);
  });

  test("should resolve knowledge base from string ID", async () => {
    const started = Date.now();
    const startMem = snapMem();
    await registerKnowledgeBase("test-retrieval-kb", kb);

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: "test-retrieval-kb",
      query: queryVector,
      topK: 3,
    });

    expect(result.count).toBe(3);
    expect(result.chunks).toHaveLength(3);
    expect(result.chunk_ids).toHaveLength(3);
    reportTime("chunk-retrieval: string-id", started);
    reportMem("chunk-retrieval: string-id", startMem);
  });
});
