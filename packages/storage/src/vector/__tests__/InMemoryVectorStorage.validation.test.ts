/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryVectorStorage, StorageValidationError } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

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

describe("InMemoryVectorStorage validation", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  let storage: InMemoryVectorStorage<typeof VecSchema, typeof VecPK>;

  beforeEach(async () => {
    storage = new InMemoryVectorStorage(VecSchema, VecPK, [], DIM);
    await storage.setupDatabase();
  });

  describe("put / putBulk vector-shape validation (write context)", () => {
    it("rejects a vector that is one entry short", async () => {
      const short = new Float32Array([1, 2, 3]);
      await expect(
        storage.put({ id: "x", vector: short, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(storage.put({ id: "x", vector: short, metadata: {} } as never)).rejects.toThrow(
        /Vector dimension mismatch on write: expected 4, got 3/
      );
      const all = (await storage.getAll()) ?? [];
      expect(all.length).toBe(0);
    });

    it("rejects a vector that is one entry too long", async () => {
      const long = new Float32Array([1, 2, 3, 4, 5]);
      await expect(storage.put({ id: "x", vector: long, metadata: {} } as never)).rejects.toThrow(
        /expected 4, got 5/
      );
    });

    it("rejects a vector containing NaN with the offending index", async () => {
      const bad = new Float32Array([1, NaN, 3, 4]);
      await expect(
        storage.put({ id: "x", vector: bad, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(storage.put({ id: "x", vector: bad, metadata: {} } as never)).rejects.toThrow(
        /index 1 is not a finite number/
      );
    });

    it("rejects a vector containing Infinity", async () => {
      // Float32Array clamps Infinity, so use a plain array to retain it.
      const bad = [1, 2, Number.POSITIVE_INFINITY, 4];
      await expect(
        storage.put({ id: "x", vector: bad as unknown as Float32Array, metadata: {} } as never)
      ).rejects.toThrow(/index 2 is not a finite number/);
    });

    it("rejects null / undefined vector values", async () => {
      await expect(
        storage.put({ id: "x", vector: null, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(
        storage.put({ id: "x", vector: undefined, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
    });

    it("putBulk rejects the whole batch when any entry is malformed", async () => {
      const good = new Float32Array([1, 2, 3, 4]);
      const bad = new Float32Array([1, 2, 3]);
      await expect(
        storage.putBulk([
          { id: "a", vector: good, metadata: {} },
          { id: "b", vector: bad, metadata: {} },
        ] as never)
      ).rejects.toBeInstanceOf(StorageValidationError);

      // Atomicity: no row from the rejected batch survived.
      const all = (await storage.getAll()) ?? [];
      expect(all.length).toBe(0);
    });
  });

  describe("similaritySearch vector-shape validation (query context)", () => {
    it("rejects a wrong-dimension query before scanning stored vectors", async () => {
      const wrongDim = new Float32Array([1, 2]);
      await expect(storage.similaritySearch(wrongDim)).rejects.toBeInstanceOf(
        StorageValidationError
      );
      await expect(storage.similaritySearch(wrongDim)).rejects.toThrow(
        /Vector dimension mismatch on query: expected 4, got 2/
      );
    });

    it("rejects a NaN query before computing cosineSimilarity", async () => {
      const badQuery = new Float32Array([0, NaN, 0, 0]);
      await expect(storage.similaritySearch(badQuery)).rejects.toBeInstanceOf(
        StorageValidationError
      );
      await expect(storage.similaritySearch(badQuery)).rejects.toThrow(
        /index 1 is not a finite number/
      );
    });
  });

  describe("similaritySearch result behavior", () => {
    it("drops negatively-correlated hits by default (parity with SQL backends)", async () => {
      // Default scoreThreshold is 0 — matches Sqlite/Postgres/Supabase. The
      // opposite vector (cosine = -1) is excluded as "not a match".
      await storage.put({ id: "opposite", vector: new Float32Array([-1, 0, 0, 0]), metadata: {} });
      await storage.put({ id: "same", vector: new Float32Array([1, 0, 0, 0]), metadata: {} });

      const results = await storage.similaritySearch(new Float32Array([1, 0, 0, 0]));

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("same");
    });

    it("retains negatively-correlated hits when scoreThreshold: -Infinity is passed", async () => {
      // Opt-in escape hatch for callers that want every result regardless of
      // correlation (e.g. K-NN with no relevance filter).
      await storage.put({ id: "opposite", vector: new Float32Array([-1, 0, 0, 0]), metadata: {} });
      await storage.put({ id: "same", vector: new Float32Array([1, 0, 0, 0]), metadata: {} });

      const results = await storage.similaritySearch(new Float32Array([1, 0, 0, 0]), {
        scoreThreshold: -Infinity,
      });

      expect(results).toHaveLength(2);
      const opposite = results.find((r) => r.id === "opposite");
      expect(opposite).toBeDefined();
      expect(opposite!.score).toBeCloseTo(-1, 5);
    });

    it("still honors an explicit scoreThreshold floor above the default", async () => {
      await storage.put({ id: "weak", vector: new Float32Array([0, 1, 0, 0]), metadata: {} });
      await storage.put({ id: "same", vector: new Float32Array([1, 0, 0, 0]), metadata: {} });

      const results = await storage.similaritySearch(new Float32Array([1, 0, 0, 0]), {
        scoreThreshold: 0.5,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("same");
    });

    it("treats a present-but-null metadata value as a non-match under a filter (no throw)", async () => {
      // A row whose metadata column is null must not crash a filtered search;
      // it is coalesced to {} and excluded by the filter rather than matched.
      //
      // VecSchema marks `metadata` required and non-nullable, so `put` now
      // rejects a null the way a NOT NULL column would. The read path still has
      // to cope with such a row — it can arrive from a backend whose metadata
      // column is nullable, or predate the column's constraint — so seed it
      // directly into the row map instead of writing it through `put`.
      await storage.put({
        id: "null-meta",
        vector: new Float32Array([1, 0, 0, 0]),
        metadata: {},
      });
      for (const row of storage.values.values()) {
        if ((row as { id: string }).id === "null-meta") {
          (row as { metadata: unknown }).metadata = null;
        }
      }
      await storage.put({
        id: "tagged",
        vector: new Float32Array([1, 0, 0, 0]),
        metadata: { tag: "keep" },
      });

      const results = await storage.similaritySearch(new Float32Array([1, 0, 0, 0]), {
        filter: { tag: "keep" },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("tagged");
    });

    it("emits a similaritySearch event with the returned results", async () => {
      await storage.put({ id: "a", vector: new Float32Array([1, 0, 0, 0]), metadata: {} });

      const seen: Array<{ query: unknown; results: unknown[] }> = [];
      // The event lives on the vector extension of the tabular event surface;
      // the public `on` is typed to the tabular names, so cast at the call site.
      (
        storage as unknown as {
          on: (name: string, fn: (query: unknown, results: unknown[]) => void) => void;
        }
      ).on("similaritySearch", (query, results) => seen.push({ query, results }));

      const out = await storage.similaritySearch(new Float32Array([1, 0, 0, 0]));
      expect(seen).toHaveLength(1);
      expect(seen[0].results).toBe(out);
    });
  });
});
