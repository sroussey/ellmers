/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "fake-indexeddb/auto";

import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import { setLogger, uuid4 } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTestingLogger } from "@workglow/util/test";

/**
 * Atomicity contract for the IndexedDB tabular `putBulk`:
 *
 * `putBulk` routes every record through a single `readwrite` transaction
 * (`putBulkInTransaction`) rather than one transaction per row. If any
 * request errors or the transaction aborts, no row lands in the object
 * store and no per-row `put` event fires. The success path defers per-row
 * `put` event emission to `tx.oncomplete`, so subscribers see a clean batch
 * commit rather than interleaved request notifications.
 */

const ItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    value: { type: "number" },
  },
  required: ["id", "value"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const ItemPK = ["id"] as const;

interface ItemEntity {
  id: string;
  value: number;
}

describe("IndexedDbTabularStorage putBulk atomicity", () => {
  const dbBase = `idb_tab_atomic_${uuid4().replace(/-/g, "_")}`;
  let storage: IndexedDbTabularStorage<typeof ItemSchema, typeof ItemPK, ItemEntity>;

  setLogger(getTestingLogger());

  beforeEach(async () => {
    const uniqueDbName = `${dbBase}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    storage = new IndexedDbTabularStorage(uniqueDbName, ItemSchema, ItemPK);
    await storage.setupDatabase();
  });

  afterEach(async () => {
    await storage.deleteAll();
    storage.destroy();
  });

  it("putBulk rolls back the entire batch when any IDB request errors", async () => {
    // Seed a row that must survive the failed batch.
    await storage.put({ id: "seed", value: 99 });

    // Force the second `store.put` request inside the transaction to abort so
    // the IDB engine sees a real request-level error and propagates it through
    // `tx.onerror` / `tx.onabort`.
    const originalPut = IDBObjectStore.prototype.put;
    let requestCount = 0;
    IDBObjectStore.prototype.put = function (value: any, key?: any) {
      requestCount += 1;
      const req = originalPut.call(this, value, key);
      if (requestCount === 2) {
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

    const batch: ItemEntity[] = [
      { id: "row-a", value: 1 },
      { id: "row-b", value: 2 },
      { id: "row-c", value: 3 },
    ];

    try {
      await expect(storage.putBulk(batch)).rejects.toBeDefined();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    // Pre-existing row survives.
    expect(await storage.get({ id: "seed" } as any)).toBeDefined();

    // None of the batch's rows land.
    expect(await storage.get({ id: "row-a" } as any)).toBeUndefined();
    expect(await storage.get({ id: "row-b" } as any)).toBeUndefined();
    expect(await storage.get({ id: "row-c" } as any)).toBeUndefined();

    expect(await storage.size()).toBe(1);
  });

  it("putBulk commits all rows on success and emits put events after tx.oncomplete", async () => {
    const seen: ItemEntity[] = [];
    const handler = (entity: ItemEntity) => {
      seen.push(entity);
    };
    storage.on("put", handler as any);

    const batch: ItemEntity[] = [
      { id: "row-1", value: 1 },
      { id: "row-2", value: 2 },
      { id: "row-3", value: 3 },
    ];

    const results = await storage.putBulk(batch);
    expect(results).toHaveLength(3);
    expect(results.map((e) => e.id)).toEqual(["row-1", "row-2", "row-3"]);
    expect(await storage.size()).toBe(3);

    // Per-record `put` events fire once each, in batch order, after
    // `tx.oncomplete` (the `await` above returned, so they all resolved).
    expect(seen.map((e) => e.id)).toEqual(["row-1", "row-2", "row-3"]);

    storage.off("put", handler as any);
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
      await expect(storage.putBulk([{ id: "x", value: 1 }])).rejects.toBeDefined();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    expect(rollbacks.length).toBeGreaterThanOrEqual(1);
    expect(rollbacks[0].op).toBe("putBulkInTransaction");
    // The success path emits per-row `put` events from `tx.oncomplete`, which
    // never runs on a rollback path, so no row was visible to subscribers.
    expect(rollbacks[0].ids).toEqual([]);
  });

  it("putBulk with autoincrement keys assigns keys and stays atomic on success", async () => {
    const AutoSchema = {
      type: "object",
      properties: {
        id: { type: "integer", "x-auto-generated": true },
        label: { type: "string" },
      },
      required: ["id", "label"],
      additionalProperties: false,
    } as const satisfies DataPortSchemaObject;
    const AutoPK = ["id"] as const;

    const autoDbName = `${dbBase}_auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const autoStorage = new IndexedDbTabularStorage(autoDbName, AutoSchema, AutoPK);
    await autoStorage.setupDatabase();

    try {
      const results = await autoStorage.putBulk([{ label: "a" } as any, { label: "b" } as any]);
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(typeof (r as any).id).toBe("number");
      }
      expect((results[0] as any).id).not.toEqual((results[1] as any).id);
      expect(await autoStorage.size()).toBe(2);
    } finally {
      await autoStorage.deleteAll();
      autoStorage.destroy();
    }
  });
});
