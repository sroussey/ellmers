/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CacheRef } from "@workglow/task-graph";
import {
  byteIterableFromBlob,
  makeCacheRef,
  RunPrivateCacheRepo,
  streamRefViaBacking,
} from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { NonStreamingMemoryRepo, StreamingMemoryRepo } from "../../binding/StreamingMemoryRepo";

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

describe("supportsStreamingReads", () => {
  it("reflects presence of getOutputStreamByRef", () => {
    expect(new StreamingMemoryRepo({}).supportsStreamingReads()).toBe(true);
    expect(new NonStreamingMemoryRepo({}).supportsStreamingReads()).toBe(false);
  });

  it("RunPrivateCacheRepo mirrors the backing's read capability", () => {
    const yes = new RunPrivateCacheRepo({ backing: new StreamingMemoryRepo({}), runId: "r" });
    const no = new RunPrivateCacheRepo({ backing: new NonStreamingMemoryRepo({}), runId: "r" });
    expect(yes.supportsStreamingReads()).toBe(true);
    expect(no.supportsStreamingReads()).toBe(false);
  });
});

describe("byteIterableFromBlob", () => {
  it("yields the blob's bytes", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
    expect(await collect(byteIterableFromBlob(blob))).toEqual([1, 2, 3, 4]);
  });
});

describe("streamRefViaBacking", () => {
  it("prefers getOutputStreamByRef when present", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { k: 1 }, gen(new Uint8Array([5, 6, 7])), {});
    let streamReaderCalled = false;
    const wrapped = {
      getOutputByRef: (r: CacheRef) => repo.getOutputByRef(r),
      getOutputStreamByRef: (r: CacheRef) => {
        streamReaderCalled = true;
        return repo.getOutputStreamByRef(r);
      },
    };
    const stream = await streamRefViaBacking(ref, wrapped);
    expect(stream).toBeDefined();
    expect(await collect(stream!)).toEqual([5, 6, 7]);
    expect(streamReaderCalled).toBe(true);
  });

  it("falls back to getOutputByRef + blob.stream() when no stream reader", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { k: 2 }, gen(new Uint8Array([8, 9])), {});
    const materializingOnly = { getOutputByRef: (r: CacheRef) => repo.getOutputByRef(r) };
    const stream = await streamRefViaBacking(ref, materializingOnly);
    expect(stream).toBeDefined();
    expect(await collect(stream!)).toEqual([8, 9]);
  });

  it("returns undefined for a dangling ref", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { k: 3 }, gen(new Uint8Array([1])), {});
    await repo.clear();
    expect(await streamRefViaBacking(ref, repo)).toBeUndefined();
  });

  it("returns undefined when the backing has no readers at all", async () => {
    const ref = makeCacheRef({ $ref: "inmem://nope" });
    expect(await streamRefViaBacking(ref, {})).toBeUndefined();
  });
});
