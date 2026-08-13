/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "fake-indexeddb/auto";

import { IndexedDbVectorStorage } from "@workglow/indexeddb/storage";
import { setLogger, uuid4 } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Atomicity contract for the IndexedDB vector `putBulk`:
 *
 * The override routes every record through a single `readwrite`
 * transaction. If any request errors or the transaction aborts, no row
 * lands in the object store and no per-row `put` event fires. The success
 * path defers per-row `put` event emission to `tx.oncomplete`, so
 * subscribers see a clean batch commit rather than interleaved request
 * notifications.
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
const DIM = 3;

interface VecEntity {
  id: string;
  vector: Float32Array;
  metadata: Record<string, unknown>;
}

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("IndexedDbVectorStorage putBulk atomicity", () => {
  const dbBase = `idb_vec_atomic_${uuid4().replace(/-/g, "_")}`;
  let storage: IndexedDbVectorStorage<
    typeof VecSchema,
    typeof VecPK,
    Record<string, unknown>,
    VecEntity
  >;

  setLogger(getTestingLogger());

  // The throwing-listener tests below intentionally raise inside the IDB
  // tx.oncomplete loop; safeEmit forwards those throws to the
  // unhandledRejection channel so observability tooling sees them, but the
  // synchronous resolve(results) path is preserved. Vitest treats stray
  // rejections as worker failures, so absorb only the two literal messages
  // these tests emit and rethrow anything else.
  const swallow = (e: unknown): void => {
    if (e instanceof Error && /listener boom|first listener boom/.test(e.message)) return;
    throw e;
  };
  beforeAll(() => {
    if (typeof process !== "undefined" && typeof process.on === "function") {
      process.on("unhandledRejection", swallow);
    }
  });
  afterAll(() => {
    if (typeof process !== "undefined" && typeof process.off === "function") {
      process.off("unhandledRejection", swallow);
    }
  });

  beforeEach(async () => {
    const uniqueDbName = `${dbBase}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    storage = new IndexedDbVectorStorage(uniqueDbName, VecSchema, VecPK, [], DIM, Float32Array);
    await storage.setupDatabase();
  });

  afterEach(async () => {
    await storage.deleteAll();
    storage.destroy();
  });

  it("putBulk rolls back the entire batch when any IDB request errors", async () => {
    // Seed a row that must survive the failed batch.
    await storage.put({ id: "seed", vector: vec([0, 0, 1]), metadata: { keep: true } });

    // Force the second `store.put` request inside the transaction to abort.
    // `fake-indexeddb` does not enforce structured-clone (so we cannot rely
    // on a poisoned getter to fire `onerror`), and `store.put` is upsert (so
    // a duplicate key does not collide). Patching `IDBObjectStore.prototype.put`
    // for the duration of the batch lets us deterministically inject the
    // request-level error our atomicity guarantee is supposed to recover from.
    const originalPut = IDBObjectStore.prototype.put;
    let requestCount = 0;
    IDBObjectStore.prototype.put = function (value: any, key?: any) {
      requestCount += 1;
      const req = originalPut.call(this, value, key);
      if (requestCount === 2) {
        // Defer aborting the transaction until after the request kicks off
        // so the IDB engine sees a real request-level error and propagates
        // it through `tx.onerror`.
        queueMicrotask(() => {
          try {
            (this.transaction as IDBTransaction).abort();
          } catch {
            // best-effort
          }
        });
      }
      return req;
    };

    const batch = [
      { id: "row-a", vector: vec([1, 0, 0]), metadata: {} },
      { id: "row-b", vector: vec([0, 1, 0]), metadata: {} },
      { id: "row-c", vector: vec([0, 0, 1]), metadata: {} },
    ];

    try {
      await expect(storage.putBulk(batch)).rejects.toBeDefined();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    // Pre-existing row survives.
    const survivor = await storage.get({ id: "seed" } as any);
    expect(survivor).toBeDefined();

    // None of the batch's rows land.
    expect(await storage.get({ id: "row-a" } as any)).toBeUndefined();
    expect(await storage.get({ id: "row-b" } as any)).toBeUndefined();
    expect(await storage.get({ id: "row-c" } as any)).toBeUndefined();

    expect(await storage.size()).toBe(1);
  });

  it("putBulk commits all rows on success in a single transaction and emits put events after tx.oncomplete", async () => {
    const seen: VecEntity[] = [];
    const handler = (entity: VecEntity) => {
      seen.push(entity);
    };
    storage.on("put", handler as any);

    const batch = [
      { id: "row-1", vector: vec([1, 0, 0]), metadata: { tag: "a" } },
      { id: "row-2", vector: vec([0, 1, 0]), metadata: { tag: "b" } },
      { id: "row-3", vector: vec([0, 0, 1]), metadata: { tag: "c" } },
    ];

    const results = await storage.putBulk(batch);
    expect(results).toHaveLength(3);
    expect(await storage.size()).toBe(3);

    // Per-record `put` events fire once each, in batch order, after
    // `tx.oncomplete` (the `await` above returned, so they all already
    // resolved by this point).
    expect(seen.map((e) => e.id)).toEqual(["row-1", "row-2", "row-3"]);

    storage.off("put", handler as any);
  });

  it("does not hang putBulk when a put listener throws on the success path", async () => {
    // The IDB success path emits per-row `put` events from `tx.oncomplete`
    // before resolving the putBulk promise. A throwing listener in that loop
    // used to abort the loop and skip the `resolve(results)` call, so the
    // promise hung forever even though the writes had committed. Routing
    // through `safeEmit` neutralizes the throw so resolution still happens.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    storage.on("put", (() => {
      throw new Error("listener boom");
    }) as any);

    const batch = [
      { id: "row-1", vector: vec([1, 0, 0]), metadata: { tag: "a" } },
      { id: "row-2", vector: vec([0, 1, 0]), metadata: { tag: "b" } },
      { id: "row-3", vector: vec([0, 0, 1]), metadata: { tag: "c" } },
    ];

    let hangTimer: ReturnType<typeof setTimeout> | undefined;
    const hangGuard = new Promise<never>((_, reject) => {
      hangTimer = setTimeout(() => reject(new Error("putBulk hung")), 2000);
    });

    try {
      const results = await Promise.race([storage.putBulk(batch), hangGuard]);
      expect(results).toHaveLength(3);
    } finally {
      if (hangTimer) clearTimeout(hangTimer);
    }

    // Writes actually committed.
    expect(await storage.get({ id: "row-1" } as any)).toBeDefined();
    expect(await storage.get({ id: "row-2" } as any)).toBeDefined();
    expect(await storage.get({ id: "row-3" } as any)).toBeDefined();
  });

  it("still fires later put listeners when an earlier one throws on the success path", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const collected: string[] = [];
    storage.on("put", (() => {
      throw new Error("first listener boom");
    }) as any);
    storage.on("put", ((entity: VecEntity) => {
      collected.push(entity.id);
    }) as any);

    const batch = [
      { id: "row-a", vector: vec([1, 0, 0]), metadata: {} },
      { id: "row-b", vector: vec([0, 1, 0]), metadata: {} },
      { id: "row-c", vector: vec([0, 0, 1]), metadata: {} },
    ];

    const results = await storage.putBulk(batch);
    expect(results).toHaveLength(3);
    expect(collected).toEqual(["row-a", "row-b", "row-c"]);
  });

  it("emits a rollback event on failure", async () => {
    const rollbacks: Array<{ op: string; error: unknown; ids: readonly unknown[] }> = [];
    storage.on("rollback" as any, (reason: any) => rollbacks.push(reason));

    // Abort the very first request to force the rollback path.
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: any) {
      const req = originalPut.call(this, value, key);
      queueMicrotask(() => {
        try {
          (this.transaction as IDBTransaction).abort();
        } catch {
          // best-effort
        }
      });
      return req;
    };

    try {
      await expect(
        storage.putBulk([{ id: "x", vector: vec([1, 0, 0]), metadata: {} }])
      ).rejects.toBeDefined();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    expect(rollbacks.length).toBeGreaterThanOrEqual(1);
    expect(rollbacks[0].op).toBe("putBulkInTransaction");
    // The IDB success path emits per-row `put` events from `tx.oncomplete`,
    // which never runs on a rollback path, so no row was visible to
    // subscribers; the payload reports an empty `ids` list.
    expect(rollbacks[0].ids).toEqual([]);
  });
});
