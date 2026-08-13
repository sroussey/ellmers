/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "fake-indexeddb/auto";

import { IndexedDbVectorStorage } from "@workglow/indexeddb/storage";
import { setLogger, uuid4 } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const VectorSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string" },
    doc_id: { type: "string" },
    vector: { type: "array", items: { type: "number" }, format: "TypedArray" },
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["chunk_id", "doc_id", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

type VectorEntity = {
  chunk_id: string;
  doc_id: string;
  vector: Float32Array;
  metadata: Record<string, unknown>;
};

const VectorPrimaryKey = ["chunk_id"] as const;

describe("IndexedDbVectorStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  const dbName = `idx_vec_test_${uuid4().replace(/-/g, "_")}`;
  let storage: IndexedDbVectorStorage<
    typeof VectorSchema,
    typeof VectorPrimaryKey,
    Record<string, unknown>,
    VectorEntity
  >;

  const testVectors = [
    new Float32Array([1.0, 0.0, 0.0]), // doc1 - similar to query
    new Float32Array([0.8, 0.2, 0.0]), // doc2 - somewhat similar
    new Float32Array([0.0, 1.0, 0.0]), // doc3 - different
    new Float32Array([0.0, 0.0, 1.0]), // doc4 - different
    new Float32Array([0.9, 0.1, 0.0]), // doc5 - very similar
  ];

  const testMetadata = [
    { text: "Document about AI", category: "tech" },
    { text: "Document about machine learning", category: "tech" },
    { text: "Document about cooking", category: "food" },
    { text: "Document about travel", category: "travel" },
    { text: "Document about artificial intelligence", category: "tech" },
  ];

  async function populateStorage() {
    for (let i = 0; i < testVectors.length; i++) {
      const doc_id = `doc${i + 1}`;
      await storage.put({
        chunk_id: `${doc_id}_0`,
        doc_id,
        vector: testVectors[i],
        metadata: testMetadata[i],
      });
    }
  }

  beforeEach(async () => {
    const uniqueDbName = `${dbName}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    storage = new IndexedDbVectorStorage(
      uniqueDbName,
      VectorSchema,
      VectorPrimaryKey,
      [],
      3,
      Float32Array
    );
    await storage.setupDatabase();
  });

  afterEach(async () => {
    await storage.deleteAll();
    storage.destroy();
  });

  describe("constructor", () => {
    it("should throw when schema has no TypedArray property", () => {
      const badSchema = {
        type: "object",
        properties: {
          id: { type: "string" },
          value: { type: "number" },
        },
        required: ["id", "value"],
        additionalProperties: false,
      } as const satisfies DataPortSchemaObject;

      expect(
        () => new IndexedDbVectorStorage(`${dbName}_bad`, badSchema, ["id"] as const, [], 3)
      ).toThrow("Schema must have a property with type array and format TypedArray");
    });

    it("should report correct vector dimensions", () => {
      expect(storage.getVectorDimensions()).toBe(3);
    });
  });

  describe("CRUD operations (inherited from IndexedDbTabularStorage)", () => {
    it("should put and get a vector entity", async () => {
      await storage.put({
        chunk_id: "test1",
        doc_id: "doc1",
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: { text: "hello" },
      });

      const result = await storage.get({ chunk_id: "test1" } as any);
      expect(result).toBeDefined();
      expect(result!.chunk_id).toBe("test1");
      expect(result!.doc_id).toBe("doc1");
      // IndexedDB preserves TypedArrays via structured clone
      expect(result!.vector).toBeInstanceOf(Float32Array);
      expect(Array.from(result!.vector)).toEqual([1.0, 0.0, 0.0]);
    });

    it("should store and retrieve multiple entities", async () => {
      await populateStorage();
      const all = await storage.getAll();
      expect(all).toBeDefined();
      expect(all!.length).toBe(5);
    });

    it("should delete entities", async () => {
      await populateStorage();
      await storage.delete({ chunk_id: "doc1_0" } as any);
      const all = await storage.getAll();
      expect(all).toBeDefined();
      expect(all!.length).toBe(4);
    });

    it("should delete all entities", async () => {
      await populateStorage();
      await storage.deleteAll();
      const all = await storage.getAll();
      expect(all).toBeUndefined();
    });
  });

  describe("similaritySearch", () => {
    beforeEach(async () => {
      await populateStorage();
    });

    it("should return results sorted by similarity score descending", async () => {
      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = await storage.similaritySearch(query, { topK: 5 });

      expect(results.length).toBe(5);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("should return the most similar vector first", async () => {
      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = await storage.similaritySearch(query, { topK: 3 });

      // Exact match should be first
      expect(results[0].chunk_id).toBe("doc1_0");
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });

    it("should respect topK limit", async () => {
      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = await storage.similaritySearch(query, { topK: 2 });

      expect(results.length).toBe(2);
    });

    it("should filter by metadata", async () => {
      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = await storage.similaritySearch(query, {
        topK: 10,
        filter: { category: "tech" },
      });

      expect(results.length).toBe(3);
      results.forEach((r) => {
        expect(r.metadata).toHaveProperty("category", "tech");
      });
    });

    it("should apply score threshold", async () => {
      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = await storage.similaritySearch(query, {
        topK: 10,
        scoreThreshold: 0.9,
      });

      results.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0.9);
      });
      // doc3 and doc4 should be excluded (orthogonal vectors, score ~0)
      expect(results.length).toBeLessThan(5);
    });

    it("should combine filter and score threshold", async () => {
      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = await storage.similaritySearch(query, {
        topK: 10,
        filter: { category: "tech" },
        scoreThreshold: 0.7,
      });

      results.forEach((r) => {
        expect(r.metadata).toHaveProperty("category", "tech");
        expect(r.score).toBeGreaterThanOrEqual(0.7);
      });
    });

    it("should return empty results when no matches", async () => {
      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = await storage.similaritySearch(query, {
        topK: 10,
        filter: { category: "nonexistent" },
      });

      expect(results.length).toBe(0);
    });

    it("should handle empty storage", async () => {
      await storage.deleteAll();
      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = await storage.similaritySearch(query, { topK: 10 });

      expect(results.length).toBe(0);
    });

    it("should work with quantized query vectors (Int8Array)", async () => {
      const query = new Int8Array([127, 0, 0]);
      const results = await storage.similaritySearch(query, { topK: 3 });

      expect(results.length).toBeGreaterThan(0);
      // Most similar should still be doc1
      expect(results[0].chunk_id).toBe("doc1_0");
    });
  });
});
