/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { StorageValidationError } from "@workglow/storage";
import { SupabaseVectorStorage } from "@workglow/supabase/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

/**
 * Unit-level validation tests: every rejection here must happen *before* the
 * Supabase client is touched. The stub asserts that by exploding on any
 * unexpected method call — pgvector and the network are out of scope for this
 * suite.
 */
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

interface StubClient {
  readonly rpcCalls: string[];
  readonly fromCalls: string[];
  readonly client: SupabaseClient;
}

function makeStubClient(): StubClient {
  const rpcCalls: string[] = [];
  const fromCalls: string[] = [];

  const client = {
    rpc: (name: string) => {
      rpcCalls.push(name);
      throw new Error(`unexpected rpc(${name}) — validation should reject first`);
    },
    from: (table: string) => {
      fromCalls.push(table);
      throw new Error(`unexpected from(${table}) — validation should reject first`);
    },
    channel: () => {
      throw new Error("unexpected channel() call in validation test");
    },
    removeChannel: () => undefined,
  } as unknown as SupabaseClient;

  return { rpcCalls, fromCalls, client };
}

function newStore(client: SupabaseClient): SupabaseVectorStorage<
  typeof VecSchema,
  typeof VecPK
> {
  return new SupabaseVectorStorage(client, "vec_items", VecSchema, VecPK, [], DIM);
}

describe("SupabaseVectorStorage validation", () => {
  describe("put / putBulk vector-shape validation (write context)", () => {
    it("rejects a vector that is one entry short", async () => {
      const stub = makeStubClient();
      const store = newStore(stub.client);
      const short = new Float32Array([1, 2, 3]); // dim 3, expected 4
      await expect(
        store.put({ id: "x", vector: short, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(
        store.put({ id: "x", vector: short, metadata: {} } as never)
      ).rejects.toThrow(/Vector dimension mismatch on write: expected 4, got 3/);
      expect(stub.fromCalls).toEqual([]);
    });

    it("rejects a vector that is one entry too long", async () => {
      const stub = makeStubClient();
      const store = newStore(stub.client);
      const long = new Float32Array([1, 2, 3, 4, 5]);
      await expect(
        store.put({ id: "x", vector: long, metadata: {} } as never)
      ).rejects.toThrow(/expected 4, got 5/);
      expect(stub.fromCalls).toEqual([]);
    });

    it("rejects a vector containing NaN with the index", async () => {
      const stub = makeStubClient();
      const store = newStore(stub.client);
      const bad = new Float32Array([1, NaN, 3, 4]);
      await expect(
        store.put({ id: "x", vector: bad, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(
        store.put({ id: "x", vector: bad, metadata: {} } as never)
      ).rejects.toThrow(/index 1 is not a finite number/);
      expect(stub.fromCalls).toEqual([]);
    });

    it("rejects a vector containing Infinity", async () => {
      const stub = makeStubClient();
      const store = newStore(stub.client);
      // Float32Array clamps, so use a plain array to keep Infinity.
      const bad = [1, 2, Number.POSITIVE_INFINITY, 4];
      await expect(
        store.put({ id: "x", vector: bad as unknown as Float32Array, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(
        store.put({ id: "x", vector: bad as unknown as Float32Array, metadata: {} } as never)
      ).rejects.toThrow(/index 2 is not a finite number/);
      expect(stub.fromCalls).toEqual([]);
    });

    it("rejects null / undefined vector values", async () => {
      const stub = makeStubClient();
      const store = newStore(stub.client);
      await expect(
        store.put({ id: "x", vector: null, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(
        store.put({ id: "x", vector: undefined, metadata: {} } as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      expect(stub.fromCalls).toEqual([]);
    });

    it("putBulk rejects when any vector is malformed and never partially writes", async () => {
      const stub = makeStubClient();
      const store = newStore(stub.client);
      const good = new Float32Array([1, 2, 3, 4]);
      const bad = new Float32Array([1, 2, 3]); // wrong dim
      await expect(
        store.putBulk([
          { id: "a", vector: good, metadata: {} },
          { id: "b", vector: bad, metadata: {} },
        ] as never)
      ).rejects.toBeInstanceOf(StorageValidationError);
      expect(stub.fromCalls).toEqual([]);
      expect(stub.rpcCalls).toEqual([]);
    });
  });

  describe("similaritySearch vector-shape validation (query context)", () => {
    it("rejects a query of wrong dimension before invoking rpc()", async () => {
      const stub = makeStubClient();
      const store = newStore(stub.client);
      const wrongDim = new Float32Array([1, 2]);
      await expect(store.similaritySearch(wrongDim)).rejects.toBeInstanceOf(StorageValidationError);
      await expect(store.similaritySearch(wrongDim)).rejects.toThrow(
        /Vector dimension mismatch on query: expected 4, got 2/
      );
      expect(stub.rpcCalls).toEqual([]);
    });

    it("rejects NaN in the query vector before invoking rpc()", async () => {
      const stub = makeStubClient();
      const store = newStore(stub.client);
      const badQuery = new Float32Array([0, NaN, 0, 0]);
      await expect(store.similaritySearch(badQuery)).rejects.toThrow(
        /index 1 is not a finite number/
      );
      expect(stub.rpcCalls).toEqual([]);
    });
  });
});
