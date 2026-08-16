/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `StreamingIndexedDbTaskOutputRepository` is a durable, browser-oriented
 * streaming cache backing: JSON rows via `IndexedDbTabularStorage`, binary
 * payloads as chunked blobs in a dedicated IndexedDB database. It mirrors
 * `FsFolderTaskOutputRepository`'s streaming surface with async reads.
 */

import type { StreamEvent } from "@workglow/task-graph";
import {
  getStreamPortCodec,
  isCacheRef,
  makeCacheRef,
  streamRefViaBacking,
} from "@workglow/task-graph";
import { uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StreamingIndexedDbTaskOutputRepository } from "../../binding/StreamingIndexedDbTaskOutputRepository";

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const it of items) yield it;
}
async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}
async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

describe("StreamingIndexedDbTaskOutputRepository capability probes", () => {
  it("advertises the streaming surface", async () => {
    const repo = new StreamingIndexedDbTaskOutputRepository(`probe_${uuid4().replace(/-/g, "_")}`);
    await repo.setupDatabase();
    expect(repo.supportsStreaming()).toBe(true);
    expect(typeof repo.getOutputStreamByRef).toBe("function");
    expect(repo.isDurable()).toBe(true);
    await repo.clear();
  });
});

describe("StreamingIndexedDbTaskOutputRepository.saveOutputStreamPort round-trips", () => {
  let repo: StreamingIndexedDbTaskOutputRepository;

  beforeEach(async () => {
    repo = new StreamingIndexedDbTaskOutputRepository(`sp_${uuid4().replace(/-/g, "_")}`);
    await repo.setupDatabase();
  });
  afterEach(async () => {
    await repo.clear();
  });

  it("round-trips an append (text) port through a ref", async () => {
    const codec = getStreamPortCodec("append");
    const events: StreamEvent[] = [
      { type: "text-delta", port: "text", textDelta: "Bonjour" },
      { type: "text-delta", port: "text", textDelta: " monde" },
    ];
    const ref = await repo.saveOutputStreamPort(
      "T",
      { p: 1 },
      "text",
      "append",
      codec.encode(fromArray(events), "text"),
      {}
    );
    expect(isCacheRef(ref)).toBe(true);
    expect(ref.port).toBe("text");
    expect(ref.mode).toBe("append");
    expect(ref.size).toBeGreaterThan(0);
    const back = await repo.getOutputStreamByRef(ref);
    expect(back).toBeDefined();
    expect(await codec.materialize(back!, "text")).toBe("Bonjour monde");
  });

  it("round-trips an object (NDJSON) port through a ref", async () => {
    const codec = getStreamPortCodec("object");
    const events: StreamEvent[] = [
      { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "a" }] },
      { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "b" }] },
      { type: "object-delta", port: "items", objectDelta: [{ id: 2, v: "c" }] },
    ];
    const ref = await repo.saveOutputStreamPort(
      "T",
      { p: 1 },
      "items",
      "object",
      codec.encode(fromArray(events), "items"),
      {}
    );
    expect(ref.mode).toBe("object");
    const back = await repo.getOutputStreamByRef(ref);
    expect(await codec.materialize(back!, "items")).toEqual([
      { id: 1, v: "b" },
      { id: 2, v: "c" },
    ]);
  });

  it("round-trips a binary port through a ref (also via getOutputByRef Blob)", async () => {
    const codec = getStreamPortCodec("binary");
    const events: StreamEvent[] = [
      { type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([10, 20]) },
      { type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([30]) },
    ];
    const ref = await repo.saveOutputStreamPort(
      "T",
      { p: 1 },
      "file",
      "binary",
      codec.encode(fromArray(events), "file"),
      {}
    );
    const blob = await repo.getOutputByRef(ref);
    expect(blob).toBeDefined();
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([10, 20, 30]);
  });

  it("keeps distinct ports of the same (taskType, inputs) at distinct refs", async () => {
    const text = getStreamPortCodec("append");
    const bin = getStreamPortCodec("binary");
    const a = await repo.saveOutputStreamPort(
      "T",
      { p: 9 },
      "text",
      "append",
      text.encode(fromArray([{ type: "text-delta", port: "text", textDelta: "x" }]), "text"),
      {}
    );
    const b = await repo.saveOutputStreamPort(
      "T",
      { p: 9 },
      "file",
      "binary",
      bin.encode(
        fromArray([{ type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([1]) }]),
        "file"
      ),
      {}
    );
    expect(a.$ref).not.toBe(b.$ref);
    expect(await text.materialize((await repo.getOutputStreamByRef(a))!, "text")).toBe("x");
    const blob = await repo.getOutputByRef(b);
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1]);
  });
});

describe("StreamingIndexedDbTaskOutputRepository stream-out contract", () => {
  let repo: StreamingIndexedDbTaskOutputRepository;
  let dbName: string;

  beforeEach(async () => {
    dbName = `sc_${uuid4().replace(/-/g, "_")}`;
    repo = new StreamingIndexedDbTaskOutputRepository(dbName);
    await repo.setupDatabase();
  });
  afterEach(async () => {
    await repo.clear();
  });

  it("round-trips a multi-chunk write through getOutputStreamByRef", async () => {
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])),
      {}
    );
    expect(ref.size).toBe(6);
    const stream = await repo.getOutputStreamByRef(ref);
    expect(await collect(stream!)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("round-trips through the materializing reader too", async () => {
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 2 },
      "file",
      "binary",
      gen(new Uint8Array([7, 8])),
      {
        mime: "application/octet-stream",
      }
    );
    expect(ref.mime).toBe("application/octet-stream");
    const blob = await repo.getOutputByRef(ref);
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([7, 8]);
  });

  it("returns undefined from both readers for an unknown ref", async () => {
    const ref = makeCacheRef({ $ref: "idbblob://never-written" });
    expect(await repo.getOutputByRef(ref)).toBeUndefined();
    expect(await repo.getOutputStreamByRef(ref)).toBeUndefined();
  });

  it("rejects foreign / path-traversal shaped refs", async () => {
    const evil = makeCacheRef({ $ref: "idbblob://../../etc/passwd" });
    const foreign = makeCacheRef({ $ref: "fsfolder://blobs/x.bin" });
    expect(await repo.getOutputByRef(evil)).toBeUndefined();
    expect(await repo.getOutputStreamByRef(evil)).toBeUndefined();
    expect(await repo.getOutputByRef(foreign)).toBeUndefined();
    expect(await repo.getOutputStreamByRef(foreign)).toBeUndefined();
  });

  it("clear() makes previously written refs dangle (a miss, not empty)", async () => {
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 4 },
      "file",
      "binary",
      gen(new Uint8Array([1])),
      {}
    );
    await repo.clear();
    expect(await repo.getOutputByRef(ref)).toBeUndefined();
    expect(await repo.getOutputStreamByRef(ref)).toBeUndefined();
    // Through the runtime helper, a dangling ref resolves to undefined (=> miss).
    expect(await streamRefViaBacking(ref, repo)).toBeUndefined();
  });

  it("clearOlderThan prunes blob payloads alongside rows", async () => {
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 5 },
      "file",
      "binary",
      gen(new Uint8Array([1])),
      {}
    );
    // Negative age puts the cutoff in the future: everything is "older".
    await repo.clearOlderThan(-60_000);
    expect(await repo.getOutputStreamByRef(ref)).toBeUndefined();
  });

  it("a sibling instance over the same dbName resolves the ref (cross-instance)", async () => {
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 6 },
      "file",
      "binary",
      gen(new Uint8Array([4, 2])),
      {}
    );
    const sibling = new StreamingIndexedDbTaskOutputRepository(dbName);
    await sibling.setupDatabase();
    expect(await collect((await sibling.getOutputStreamByRef(ref))!)).toEqual([4, 2]);
    const blob = await sibling.getOutputByRef(ref);
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([4, 2]);
  });
});

describe("StreamingIndexedDbTaskOutputRepository replay parity", () => {
  it("replays a saved object-port ref as decoded deltas (cache-hit parity)", async () => {
    const repo = new StreamingIndexedDbTaskOutputRepository(`replay_${uuid4().replace(/-/g, "_")}`);
    await repo.setupDatabase();
    const codec = getStreamPortCodec("object");
    const events: StreamEvent[] = [
      { type: "object-delta", port: "items", objectDelta: [{ id: 1 }] },
      { type: "object-delta", port: "items", objectDelta: [{ id: 2 }] },
    ];
    const ref = await repo.saveOutputStreamPort(
      "E2E",
      { q: 1 },
      "items",
      "object",
      codec.encode(fromArray(events), "items"),
      {}
    );
    // The runtime replay path pulls bytes via streamRefViaBacking, then decodes
    // through the port codec — assert the decoded deltas fold to the original.
    const bytes = await streamRefViaBacking(ref, repo);
    expect(bytes).toBeDefined();
    const decoded: unknown[] = [];
    for await (const e of codec.decode(bytes!, "items")) {
      decoded.push((e as { objectDelta: unknown }).objectDelta);
    }
    expect(decoded).toEqual([[{ id: 1 }], [{ id: 2 }]]);
    await repo.clear();
  });
});
