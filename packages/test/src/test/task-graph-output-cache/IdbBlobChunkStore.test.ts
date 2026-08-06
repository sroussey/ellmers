/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdbBlobChunkStore } from "../../binding/IdbBlobChunkStore";

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}
async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

/** Open the store's raw backing database (`<dbName>__blobs`) for inspection. */
function openRaw(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`${dbName}__blobs`);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Count the chunk rows stored for one refKey, bypassing the store's readers. */
async function chunkRowsFor(dbName: string, refKey: string): Promise<number> {
  const db = await openRaw(dbName);
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction("chunks", "readonly");
      const req = tx.objectStore("chunks").count(IDBKeyRange.bound([refKey], [refKey, []]));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Simulate a crashed writer: a committed chunk row with no manifest row. */
async function plantOrphanChunk(dbName: string, refKey: string): Promise<void> {
  const db = await openRaw(dbName);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("chunks", "readwrite");
      tx.objectStore("chunks").put({ refKey, seq: 0, bytes: Uint8Array.from([1, 2, 3]) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

describe("IdbBlobChunkStore", () => {
  let store: IdbBlobChunkStore;
  let dbName: string;

  beforeEach(async () => {
    dbName = `blobstore_${uuid4().replace(/-/g, "_")}`;
    store = new IdbBlobChunkStore(dbName);
    await store.setup();
  });
  afterEach(async () => {
    await store.clear();
    store.close();
  });

  it("writes a multi-chunk stream and reads it back in order", async () => {
    const refKey = "r1";
    const size = await store.writeStream(
      refKey,
      gen(Uint8Array.from([1, 2]), Uint8Array.from([3]))
    );
    expect(size).toBe(3);
    expect(await store.has(refKey)).toBe(true);
    const stream = await store.readStream(refKey);
    expect(stream).toBeDefined();
    expect(await collect(stream!)).toEqual([1, 2, 3]);
  });

  it("reads back a Blob of the whole payload", async () => {
    await store.writeStream("r2", gen(Uint8Array.from([7, 8, 9])));
    const blob = await store.readBlob("r2");
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([7, 8, 9]);
  });

  it("preserves a zero-byte payload as present (not a miss)", async () => {
    const size = await store.writeStream("empty", gen());
    expect(size).toBe(0);
    expect(await store.has("empty")).toBe(true);
    expect(await collect((await store.readStream("empty"))!)).toEqual([]);
    expect(await store.readBlob("empty")).toBeInstanceOf(Blob);
  });

  it("returns undefined readers for a missing ref", async () => {
    expect(await store.has("nope")).toBe(false);
    expect(await store.readStream("nope")).toBeUndefined();
    expect(await store.readBlob("nope")).toBeUndefined();
  });

  it("paged reads yield bounded chunks and cover the whole payload", async () => {
    // 10 one-byte chunks, page size 3 -> multiple short transactions.
    const bytes = Array.from({ length: 10 }, (_, i) => Uint8Array.from([i]));
    await store.writeStream("paged", gen(...bytes));
    const small = new IdbBlobChunkStore(dbName, 3);
    await small.setup();
    expect(await collect((await small.readStream("paged"))!)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    small.close();
  });

  it("deleteRef removes chunks and manifest", async () => {
    await store.writeStream("r3", gen(Uint8Array.from([1])));
    await store.deleteRef("r3");
    expect(await store.has("r3")).toBe(false);
    expect(await store.readStream("r3")).toBeUndefined();
  });

  it("pruneOlderThan deletes entries older than the cutoff", async () => {
    await store.writeStream("old", gen(Uint8Array.from([1])), "2000-01-01T00:00:00.000Z");
    await store.writeStream("new", gen(Uint8Array.from([2])), "2100-01-01T00:00:00.000Z");
    await store.pruneOlderThan("2050-01-01T00:00:00.000Z");
    expect(await store.has("old")).toBe(false);
    expect(await store.has("new")).toBe(true);
  });

  it("a sibling store over the same dbName resolves written refs", async () => {
    await store.writeStream("shared", gen(Uint8Array.from([4, 2])));
    const sibling = new IdbBlobChunkStore(dbName);
    await sibling.setup();
    expect(await collect((await sibling.readStream("shared"))!)).toEqual([4, 2]);
    sibling.close();
  });

  it("a failing producer leaves no committed chunk rows behind", async () => {
    // Two 200 KiB chunks cross the ~256 KiB write-page budget, so rows are
    // COMMITTED before the producer throws; the failure path must delete them
    // (mirroring FsFolder's `.tmp` cleanup) rather than strand orphans.
    async function* failing(): AsyncIterable<Uint8Array> {
      yield new Uint8Array(200 * 1024).fill(1);
      yield new Uint8Array(200 * 1024).fill(2);
      throw new Error("producer failed");
    }
    await expect(store.writeStream("doomed", failing())).rejects.toThrow("producer failed");
    expect(await store.has("doomed")).toBe(false);
    expect(await chunkRowsFor(dbName, "doomed")).toBe(0);
  });

  it("pruneOlderThan sweeps orphaned chunk rows that lack a manifest", async () => {
    await store.writeStream("live", gen(Uint8Array.from([7])), "2100-01-01T00:00:00.000Z");
    await plantOrphanChunk(dbName, "ghost");
    expect(await chunkRowsFor(dbName, "ghost")).toBe(1);
    // Cutoff far in the past: no manifested ref is old enough to prune, but
    // the manifest-less orphan (unreadable, timestamp-less) is swept anyway.
    await store.pruneOlderThan("2000-01-01T00:00:00.000Z");
    expect(await chunkRowsFor(dbName, "ghost")).toBe(0);
    expect(await collect((await store.readStream("live"))!)).toEqual([7]);
  });

  it("batches multi-page writes and round-trips the full payload", async () => {
    // 6 x 100 KiB fills the ~256 KiB write-page budget twice; rows stay one
    // per incoming delta and read back in order.
    const chunks = Array.from({ length: 6 }, (_, i) => new Uint8Array(100 * 1024).fill(i + 1));
    const size = await store.writeStream("big", gen(...chunks));
    expect(size).toBe(6 * 100 * 1024);
    const stream = await store.readStream("big");
    let idx = 0;
    for await (const c of stream!) {
      expect(c.byteLength).toBe(100 * 1024);
      expect(c[0]).toBe(idx + 1);
      idx += 1;
    }
    expect(idx).toBe(6);
  });
});
