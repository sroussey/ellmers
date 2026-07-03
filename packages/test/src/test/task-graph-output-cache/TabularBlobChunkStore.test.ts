/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BlobChunkPrimaryKeyNames,
  BlobChunkSchema,
  BlobManifestPrimaryKeyNames,
  BlobManifestSchema,
  TabularBlobChunkStore,
} from "../../binding/TabularBlobChunkStore";

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}
async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

function makeStore(pageSize?: number): TabularBlobChunkStore {
  return new TabularBlobChunkStore(
    new InMemoryTabularStorage(BlobChunkSchema, BlobChunkPrimaryKeyNames, ["createdAt"]),
    new InMemoryTabularStorage(BlobManifestSchema, BlobManifestPrimaryKeyNames, ["createdAt"]),
    pageSize
  );
}

describe("TabularBlobChunkStore (InMemory backing)", () => {
  let store: TabularBlobChunkStore;

  beforeEach(async () => {
    store = makeStore();
    await store.setup();
  });
  afterEach(async () => {
    await store.clear();
  });

  it("writes a multi-chunk stream and reads it back in order", async () => {
    const size = await store.writeStream("r1", gen(Uint8Array.from([1, 2]), Uint8Array.from([3])));
    expect(size).toBe(3);
    expect(await store.has("r1")).toBe(true);
    const stream = await store.readStream("r1");
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

  it("keyset-paged reads yield bounded chunks and cover the whole payload", async () => {
    const bytes = Array.from({ length: 10 }, (_, i) => Uint8Array.from([i]));
    const small = makeStore(3);
    await small.setup();
    await small.writeStream("paged", gen(...bytes));
    expect(await collect((await small.readStream("paged"))!)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    await small.clear();
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
    expect(await collect((await store.readStream("new"))!)).toEqual([2]);
  });

  it("keeps distinct refs isolated", async () => {
    await store.writeStream("a", gen(Uint8Array.from([1, 1])));
    await store.writeStream("b", gen(Uint8Array.from([2, 2, 2])));
    expect(await collect((await store.readStream("a"))!)).toEqual([1, 1]);
    expect(await collect((await store.readStream("b"))!)).toEqual([2, 2, 2]);
  });
});
