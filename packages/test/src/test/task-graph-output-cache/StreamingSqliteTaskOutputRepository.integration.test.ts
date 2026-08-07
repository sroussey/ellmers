/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `StreamingSqliteTaskOutputRepository` is a durable, embedded streaming cache
 * backing: JSON rows via `SqliteTabularStorage`, port payloads as ordered BLOB
 * chunk rows via `TabularBlobChunkStore`. Exercised against an in-memory SQLite
 * database (node:sqlite).
 */

import { Sqlite } from "@workglow/sqlite/storage";
import type { StreamEvent } from "@workglow/task-graph";
import {
  getStreamPortCodec,
  isCacheRef,
  makeCacheRef,
  streamRefViaBacking,
} from "@workglow/task-graph";
import { uuid4 } from "@workglow/util";
import { beforeAll, describe, expect, it } from "vitest";
import { StreamingSqliteTaskOutputRepository } from "../../binding/StreamingSqliteTaskOutputRepository";

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

describe("StreamingSqliteTaskOutputRepository", () => {
  let db: Sqlite.Database;

  beforeAll(async () => {
    await Sqlite.init();
    db = new Sqlite.Database(":memory:");
  });

  async function makeRepo(): Promise<{
    repo: StreamingSqliteTaskOutputRepository;
    table: string;
  }> {
    const table = `t_${uuid4().replace(/-/g, "_")}`;
    const repo = new StreamingSqliteTaskOutputRepository(db, table);
    await repo.setupDatabase();
    return { repo, table };
  }

  it("advertises the full streaming surface and is durable", async () => {
    const { repo } = await makeRepo();
    expect(repo.supportsStreaming()).toBe(true);
    expect(typeof repo.getOutputStreamByRef).toBe("function");
    expect(repo.supportsStreamingPorts()).toBe(true);
    expect(repo.isDurable()).toBe(true);
  });

  it("round-trips an append (text) port through a ref", async () => {
    const { repo } = await makeRepo();
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
    expect(await codec.materialize((await repo.getOutputStreamByRef(ref))!, "text")).toBe(
      "Bonjour monde"
    );
  });

  it("round-trips an object (NDJSON) port through a ref", async () => {
    const { repo } = await makeRepo();
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
    expect(await codec.materialize((await repo.getOutputStreamByRef(ref))!, "items")).toEqual([
      { id: 1, v: "b" },
      { id: 2, v: "c" },
    ]);
  });

  it("round-trips a binary port through a ref (BLOB) and via getOutputByRef", async () => {
    const { repo } = await makeRepo();
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
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([10, 20, 30]);
    expect(await collect((await repo.getOutputStreamByRef(ref))!)).toEqual([10, 20, 30]);
  });

  it("round-trips a multi-chunk saveOutputStream and reports size", async () => {
    const { repo } = await makeRepo();
    const ref = await repo.saveOutputStream(
      "T",
      { k: 1 },
      gen(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])),
      { mime: "application/octet-stream" }
    );
    expect(ref.size).toBe(6);
    expect(ref.mime).toBe("application/octet-stream");
    expect(await collect((await repo.getOutputStreamByRef(ref))!)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps distinct ports of the same (taskType, inputs) at distinct refs", async () => {
    const { repo } = await makeRepo();
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

  it("returns undefined from both readers for unknown / foreign refs", async () => {
    const { repo } = await makeRepo();
    const unknown = makeCacheRef({ $ref: "sqliteblob://never-written" });
    const foreign = makeCacheRef({ $ref: "pgblob://x" });
    expect(await repo.getOutputByRef(unknown)).toBeUndefined();
    expect(await repo.getOutputStreamByRef(unknown)).toBeUndefined();
    expect(await repo.getOutputByRef(foreign)).toBeUndefined();
    expect(await repo.getOutputStreamByRef(foreign)).toBeUndefined();
  });

  it("clear() makes previously written refs dangle (a miss, not empty)", async () => {
    const { repo } = await makeRepo();
    const ref = await repo.saveOutputStream("T", { k: 4 }, gen(new Uint8Array([1])), {});
    await repo.clear();
    expect(await repo.getOutputByRef(ref)).toBeUndefined();
    expect(await repo.getOutputStreamByRef(ref)).toBeUndefined();
    expect(await streamRefViaBacking(ref, repo)).toBeUndefined();
  });

  it("clearOlderThan prunes blob payloads alongside rows", async () => {
    const { repo } = await makeRepo();
    const ref = await repo.saveOutputStream("T", { k: 5 }, gen(new Uint8Array([1])), {});
    await repo.clearOlderThan(-60_000);
    expect(await repo.getOutputStreamByRef(ref)).toBeUndefined();
  });

  it("a sibling instance over the same db + table resolves the ref", async () => {
    const { repo, table } = await makeRepo();
    const ref = await repo.saveOutputStream("T", { k: 6 }, gen(new Uint8Array([4, 2])), {});
    const sibling = new StreamingSqliteTaskOutputRepository(db, table);
    await sibling.setupDatabase();
    expect(await collect((await sibling.getOutputStreamByRef(ref))!)).toEqual([4, 2]);
    const blob = await sibling.getOutputByRef(ref);
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([4, 2]);
  });
});
