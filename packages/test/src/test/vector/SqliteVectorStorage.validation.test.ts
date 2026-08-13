/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite, SqliteVectorStorage } from "@workglow/sqlite/storage";
import { StorageValidationError } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

describe("SqliteVectorStorage validation", async () => {
  await Sqlite.init();

  const logger = getTestingLogger();
  setLogger(logger);

  let db: InstanceType<typeof Sqlite.Database>;
  let storage: SqliteVectorStorage<typeof VecSchema, typeof VecPK>;

  beforeEach(async () => {
    db = new Sqlite.Database(":memory:");
    storage = new SqliteVectorStorage(db, "vec_validation", VecSchema, VecPK, [], DIM);
    await storage.setupDatabase();
  });

  afterEach(async () => {
    await storage.deleteAll();
    db.close();
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

      const all = (await storage.getAll()) ?? [];
      expect(all.length).toBe(0);
    });
  });

  describe("similaritySearch vector-shape validation (query context)", () => {
    it("rejects a wrong-dimension query *before* deserializing any stored vectors", async () => {
      const wrongDim = new Float32Array([1, 2]);
      await expect(storage.similaritySearch(wrongDim)).rejects.toBeInstanceOf(
        StorageValidationError
      );
      await expect(storage.similaritySearch(wrongDim)).rejects.toThrow(
        /Vector dimension mismatch on query: expected 4, got 2/
      );
    });

    it("rejects a NaN query *before* computing cosineSimilarity", async () => {
      const badQuery = new Float32Array([0, NaN, 0, 0]);
      await expect(storage.similaritySearch(badQuery)).rejects.toBeInstanceOf(
        StorageValidationError
      );
      await expect(storage.similaritySearch(badQuery)).rejects.toThrow(
        /index 1 is not a finite number/
      );
    });
  });
});
