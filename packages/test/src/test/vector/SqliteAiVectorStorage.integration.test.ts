/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite, SqliteAiVectorStorage } from "@workglow/sqlite/storage";
import { setLogger } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const _require = createRequire(import.meta.url);

let sqliteVectorAvailable = false;
let extensionPath: string | undefined;
try {
  // Use CJS require so the platform-specific sub-package resolves correctly in ESM contexts
  const mod = _require("@sqliteai/sqlite-vector");
  extensionPath = mod.getExtensionPath() as string;
} catch {
  // No prebuilt sqlite-vector binary for this platform — the suite skips.
}
if (extensionPath !== undefined) {
  // Resolving the package but failing to load it means the driver's extension
  // support is broken, not that the platform lacks a binary. Skipping there
  // would hide the regression behind a green suite, so let it throw.
  await Sqlite.init();
  const db = new Sqlite.Database(":memory:");
  db.loadExtension(extensionPath);
  db.exec("SELECT vector_version()");
  db.close();
  sqliteVectorAvailable = true;
}

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

describe.skipIf(!sqliteVectorAvailable)("SqliteAiVectorStorage", async () => {
  await Sqlite.init();

  const logger = getTestingLogger();
  setLogger(logger);
  let db: InstanceType<typeof Sqlite.Database>;
  let storage: SqliteAiVectorStorage<
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
    db = new Sqlite.Database(":memory:");
    storage = new SqliteAiVectorStorage(
      db,
      "test_vectors",
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
    db.close();
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
        () => new SqliteAiVectorStorage(db, "bad_vectors", badSchema, ["id"] as const, [], 3)
      ).toThrow("Schema must have a property with type array and format TypedArray");
    });

    it("should report correct vector dimensions", () => {
      expect(storage.getVectorDimensions()).toBe(3);
    });
  });

  describe("CRUD operations", () => {
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

  describe("putBulk vector encoding", () => {
    // Regression: previously, putBulk fell through to the base-class path which
    // binds vectors as JSON strings (no vector_as_${suffix} wrap), so
    // vector_full_scan could not decode them and similaritySearch silently
    // fell back to in-memory cosine. These tests pin the
    // vector_as_${suffix}(?)-wrapped INSERT and the round-trip via getAll().

    it("putBulk + similaritySearch returns inserted vectors at distance 0", async () => {
      await storage.putBulk([
        {
          chunk_id: "bulk1",
          doc_id: "docB1",
          vector: new Float32Array([1.0, 0.0, 0.0]),
          metadata: { tag: "bulk" },
        },
        {
          chunk_id: "bulk2",
          doc_id: "docB2",
          vector: new Float32Array([0.0, 1.0, 0.0]),
          metadata: { tag: "bulk" },
        },
      ]);

      const results = await storage.similaritySearch(new Float32Array([1.0, 0.0, 0.0]), {
        topK: 2,
      });

      // The exact match must rank first with score ~1.0; if vectors had landed
      // as JSON BLOBs, vector_full_scan would have failed and we'd silently
      // fall back to the in-memory cosine path (which would happen to give the
      // right ordering — so we pin the score to ensure the native path ran).
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].chunk_id).toBe("bulk1");
      expect(results[0].score).toBeGreaterThanOrEqual(0.999);
    });

    it("putBulk persists vectors as Float32Array via getAll", async () => {
      // Direct encoding check — vectors must come back as TypedArrays with
      // their original values, not as raw JSON strings or Buffers.
      await storage.putBulk([
        {
          chunk_id: "enc1",
          doc_id: "docE1",
          vector: new Float32Array([0.5, 0.5, 0.5]),
          metadata: {},
        },
        {
          chunk_id: "enc2",
          doc_id: "docE2",
          vector: new Float32Array([0.1, 0.2, 0.3]),
          metadata: {},
        },
      ]);

      const all = await storage.getAll();
      expect(all).toBeDefined();
      const byId = new Map(all!.map((r) => [r.chunk_id, r]));

      const r1 = byId.get("enc1")!;
      expect(r1).toBeDefined();
      expect(r1.vector).toBeInstanceOf(Float32Array);
      expect(r1.vector.length).toBe(3);
      expect(r1.vector[0]).toBeCloseTo(0.5, 5);
      expect(r1.vector[1]).toBeCloseTo(0.5, 5);
      expect(r1.vector[2]).toBeCloseTo(0.5, 5);

      const r2 = byId.get("enc2")!;
      expect(r2).toBeDefined();
      expect(r2.vector).toBeInstanceOf(Float32Array);
      expect(r2.vector[0]).toBeCloseTo(0.1, 5);
      expect(r2.vector[1]).toBeCloseTo(0.2, 5);
      expect(r2.vector[2]).toBeCloseTo(0.3, 5);
    });

    it("mixed put + putBulk yields identical similaritySearch ordering", async () => {
      // A row written through `put` and another through `putBulk` must encode
      // their vectors identically — otherwise the bulk-encoded row would be
      // unsearchable while the single-row write would rank correctly.
      await storage.put({
        chunk_id: "single",
        doc_id: "docS",
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: { source: "put" },
      });
      await storage.putBulk([
        {
          chunk_id: "bulk-a",
          doc_id: "docBA",
          vector: new Float32Array([0.9, 0.1, 0.0]),
          metadata: { source: "bulk" },
        },
        {
          chunk_id: "bulk-b",
          doc_id: "docBB",
          vector: new Float32Array([0.0, 0.0, 1.0]),
          metadata: { source: "bulk" },
        },
      ]);

      const results = await storage.similaritySearch(new Float32Array([1.0, 0.0, 0.0]), {
        topK: 3,
      });

      expect(results.length).toBe(3);
      // Exact match first (from `put`), near-match second (from `putBulk`),
      // orthogonal vector last.
      expect(results[0].chunk_id).toBe("single");
      expect(results[1].chunk_id).toBe("bulk-a");
      expect(results[2].chunk_id).toBe("bulk-b");
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[1].score).toBeGreaterThan(results[2].score);
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
      expect(results[0].score).toBeCloseTo(1.0, 2);
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
  });

  describe("withTransaction", () => {
    // Regression: previously the createTxView proxy routed `tx.put`/`tx.putBulk`
    // to the parent's `_putInternal`/`_putBulkInternal` (the subclass had no
    // matching internals), so vectors written through `tx` landed as raw JSON
    // BLOBs that vector_full_scan could not decode — similaritySearch silently
    // fell back to the in-memory cosine path. The same path also deadlocked
    // when callers reached for the original storage's putBulk from inside
    // `withTransaction` (mutex held + nested BEGIN).

    it("tx.put encodes vectors so similaritySearch hits the native path", async () => {
      const vec = new Float32Array([1.0, 0.0, 0.0]);
      await storage.withTransaction(async (tx) => {
        await tx.put({
          chunk_id: "tx-single",
          doc_id: "docTX",
          vector: vec,
          metadata: { source: "tx.put" },
        });
      });

      const results = await storage.similaritySearch(vec, { topK: 1 });
      expect(results.length).toBe(1);
      expect(results[0].chunk_id).toBe("tx-single");
      // Score ~1.0 proves vector_full_scan decoded the row; if the vector had
      // landed as a JSON blob the native path would have errored and the
      // in-memory fallback would have run on an empty getAll() (since the row
      // would have been unreadable as a Float32Array).
      expect(results[0].score).toBeGreaterThanOrEqual(0.999);

      const all = await storage.getAll();
      expect(all).toBeDefined();
      const row = all!.find((r) => r.chunk_id === "tx-single")!;
      expect(row.vector).toBeInstanceOf(Float32Array);
      expect(row.vector.length).toBe(3);
      expect(row.vector[0]).toBeCloseTo(1.0, 5);
    });

    it("tx.putBulk encodes vectors so similaritySearch hits the native path", async () => {
      await storage.withTransaction(async (tx) => {
        await tx.putBulk([
          {
            chunk_id: "tx-bulk1",
            doc_id: "docTB1",
            vector: new Float32Array([1.0, 0.0, 0.0]),
            metadata: { tag: "tx-bulk" },
          },
          {
            chunk_id: "tx-bulk2",
            doc_id: "docTB2",
            vector: new Float32Array([0.0, 1.0, 0.0]),
            metadata: { tag: "tx-bulk" },
          },
          {
            chunk_id: "tx-bulk3",
            doc_id: "docTB3",
            vector: new Float32Array([0.9, 0.1, 0.0]),
            metadata: { tag: "tx-bulk" },
          },
        ]);
      });

      const all = await storage.getAll();
      expect(all).toBeDefined();
      expect(all!.length).toBe(3);
      for (const row of all!) {
        expect(row.vector).toBeInstanceOf(Float32Array);
        expect(row.vector.length).toBe(3);
      }

      const results = await storage.similaritySearch(new Float32Array([1.0, 0.0, 0.0]), {
        topK: 3,
      });
      expect(results.length).toBe(3);
      expect(results[0].chunk_id).toBe("tx-bulk1");
      expect(results[0].score).toBeGreaterThanOrEqual(0.999);
    });

    it("does not deadlock external putBulk queued behind a running withTransaction", async () => {
      // Public `storage.putBulk` (called from *outside* the callback, while
      // withTransaction is mid-flight) must queue on the mutex and run after
      // COMMIT/ROLLBACK — not slip into the open transaction and not hang.
      // Calling it from *inside* the callback would deadlock the mutex on
      // itself; that's documented user error. The Promise.race guards against
      // a regression where the external call hangs even from outside.

      let releaseInner: () => void = () => {};
      const innerCanFinish = new Promise<void>((resolve) => {
        releaseInner = resolve;
      });

      const txPromise = storage.withTransaction(async (tx) => {
        await tx.put({
          chunk_id: "tx-rb",
          doc_id: "docRB",
          vector: new Float32Array([1.0, 0.0, 0.0]),
          metadata: {},
        });
        await innerCanFinish;
        throw new Error("rollback");
      });

      // Yield so the queued external putBulk lands on the mutex chain.
      await Promise.resolve();
      await Promise.resolve();

      const externalBulk = storage.putBulk([
        {
          chunk_id: "external-bulk",
          doc_id: "docEB",
          vector: new Float32Array([0.0, 1.0, 0.0]),
          metadata: {},
        },
      ]);

      releaseInner();
      await expect(txPromise).rejects.toThrow("rollback");

      const deadlockGuard = new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("deadlock-timeout")), 2000)
      );

      await Promise.race([externalBulk, deadlockGuard]);

      // tx-rb rolled back, external-bulk committed independently.
      expect(await storage.get({ chunk_id: "tx-rb" } as any)).toBeUndefined();
      const ext = await storage.get({ chunk_id: "external-bulk" } as any);
      expect(ext).toBeDefined();
      expect(ext!.vector).toBeInstanceOf(Float32Array);
    });

    it("preserves insertion order across mixed tx.put + tx.putBulk", async () => {
      await storage.withTransaction(async (tx) => {
        await tx.put({
          chunk_id: "mixed-1",
          doc_id: "docM1",
          vector: new Float32Array([1.0, 0.0, 0.0]),
          metadata: { order: 1 },
        });
        await tx.putBulk([
          {
            chunk_id: "mixed-2",
            doc_id: "docM2",
            vector: new Float32Array([0.0, 1.0, 0.0]),
            metadata: { order: 2 },
          },
          {
            chunk_id: "mixed-3",
            doc_id: "docM3",
            vector: new Float32Array([0.0, 0.0, 1.0]),
            metadata: { order: 3 },
          },
        ]);
        await tx.put({
          chunk_id: "mixed-4",
          doc_id: "docM4",
          vector: new Float32Array([0.5, 0.5, 0.0]),
          metadata: { order: 4 },
        });
      });

      const all = await storage.getAll();
      expect(all).toBeDefined();
      const ordered = all!
        .filter((r) => r.chunk_id.startsWith("mixed-"))
        .sort((a, b) => Number(a.metadata.order) - Number(b.metadata.order))
        .map((r) => r.chunk_id);
      expect(ordered).toEqual(["mixed-1", "mixed-2", "mixed-3", "mixed-4"]);
    });
  });
});
