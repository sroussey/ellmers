/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { chunkRetrieval } from "@workglow/ai";
import type { KnowledgeBase } from "@workglow/knowledge-base";
import { createKnowledgeBase, registerKnowledgeBase } from "@workglow/knowledge-base";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { report, snap } from "../../binding/testTiming";

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
    const s = snap();
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
    report("chunk-retrieval: query-vector", s);
  });

  test("should extract text from metadata.text field", async () => {
    const s = snap();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 5,
    });

    // Find chunks that have text field
    const textChunks = result.chunks.filter((_chunk, idx) => {
      const meta = result.metadata[idx];
      return meta.text !== undefined;
    });

    expect(textChunks.length).toBeGreaterThan(0);
    textChunks.forEach((chunk) => {
      const originalIdx = result.chunks.indexOf(chunk);
      expect(chunk).toBe(result.metadata[originalIdx].text);
    });
    report("chunk-retrieval: extract-text", s);
  });

  test("should return vectors when returnVectors is true", async () => {
    const s = snap();
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
    report("chunk-retrieval: return-vectors", s);
  });

  test("should not return vectors when returnVectors is false", async () => {
    const s = snap();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 3,
      returnVectors: false,
    });

    expect(result.vectors).toBeUndefined();
    report("chunk-retrieval: no-vectors", s);
  });

  test("should respect topK parameter", async () => {
    const s = snap();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
      topK: 2,
    });

    expect(result.count).toBe(2);
    expect(result.chunks).toHaveLength(2);
    report("chunk-retrieval: topK", s);
  });

  test("should apply score threshold", async () => {
    const s = snap();
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
    report("chunk-retrieval: score-threshold", s);
  });

  test("should throw error when query is string without model", async () => {
    const s = snap();
    await expect(
      // @ts-expect-error - query is string but no model is provided
      chunkRetrieval({
        knowledgeBase: kb,
        query: "test query string",
        topK: 3,
      })
    ).rejects.toThrow("model");
    report("chunk-retrieval: throw-no-model", s);
  });

  test("should handle default topK value", async () => {
    const s = snap();
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      knowledgeBase: kb,
      query: queryVector,
    });

    // Default topK is 5
    expect(result.count).toBe(5);
    expect(result.count).toBeLessThanOrEqual(5);
    report("chunk-retrieval: default-topK", s);
  });

  test("should resolve knowledge base from string ID", async () => {
    const s = snap();
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
    report("chunk-retrieval: string-id", s);
  });
});
