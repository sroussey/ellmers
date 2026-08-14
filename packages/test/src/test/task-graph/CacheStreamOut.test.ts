/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CacheRef, TaskOutputRepository } from "@workglow/task-graph";
import {
  byteIterableFromBlob,
  FsFolderTaskOutputRepository,
  makeCacheRef,
  RunPrivateCacheRepo,
  streamRefViaBacking,
} from "@workglow/task-graph";
import { NonStreamingMemoryRepo, StreamingMemoryRepo } from "@workglow/task-graph/test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

describe("streaming-read capability", () => {
  it("is probed via typeof getOutputStreamByRef (the check streamRefViaBacking makes)", () => {
    expect(typeof new StreamingMemoryRepo({}).getOutputStreamByRef).toBe("function");
    expect(typeof new NonStreamingMemoryRepo({}).getOutputStreamByRef).toBe("undefined");
  });

  it("RunPrivateCacheRepo exposes by-ref reads only over a run-scoped streaming backing", () => {
    // The wrapper forwards by-ref reads only when the backing implements the
    // run-scoped stream writer (a ref can only exist here if it was written
    // through it). StreamingMemoryRepo streams for the DETERMINISTIC tier
    // (no `saveOutputStreamPortForRun`), so the run-private wrapper over it
    // exposes no readable refs and no streaming reader.
    const wrapper = new RunPrivateCacheRepo({ backing: new StreamingMemoryRepo({}), runId: "r" });
    expect(typeof wrapper.getOutputStreamByRef).toBe("undefined");
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
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([5, 6, 7])),
      {}
    );
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
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 2 },
      "file",
      "binary",
      gen(new Uint8Array([8, 9])),
      {}
    );
    const materializingOnly = { getOutputByRef: (r: CacheRef) => repo.getOutputByRef(r) };
    const stream = await streamRefViaBacking(ref, materializingOnly);
    expect(stream).toBeDefined();
    expect(await collect(stream!)).toEqual([8, 9]);
  });

  it("returns undefined for a dangling ref", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 3 },
      "file",
      "binary",
      gen(new Uint8Array([1])),
      {}
    );
    await repo.clear();
    expect(await streamRefViaBacking(ref, repo)).toBeUndefined();
  });

  it("returns undefined when the backing has no readers at all", async () => {
    const ref = makeCacheRef({ $ref: "inmem://nope" });
    expect(await streamRefViaBacking(ref, {})).toBeUndefined();
  });
});

// ============================================================================
// Stream-out contract suite — run against every streaming-capable repository
// ============================================================================

interface ContractSetup {
  readonly repo: TaskOutputRepository;
  /** A second instance over the same persistent backing (FS-only). */
  readonly sibling?: () => TaskOutputRepository;
}

function runCacheStreamOutContractTests(name: string, setup: () => Promise<ContractSetup>): void {
  describe(`stream-out contract: ${name}`, () => {
    it("round-trips a multi-chunk write through getOutputStreamByRef", async () => {
      const { repo } = await setup();
      const ref = await repo.saveOutputStreamPort!(
        "T",
        { k: 1 },
        "file",
        "binary",
        gen(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])),
        {}
      );
      expect(typeof repo.getOutputStreamByRef).toBe("function");
      expect(ref.size).toBe(6);
      const stream = await repo.getOutputStreamByRef!(ref);
      expect(stream).toBeDefined();
      expect(await collect(stream!)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("round-trips through the materializing reader too", async () => {
      const { repo } = await setup();
      const ref = await repo.saveOutputStreamPort!(
        "T",
        { k: 2 },
        "file",
        "binary",
        gen(new Uint8Array([7, 8])),
        {}
      );
      const blob = await repo.getOutputByRef!(ref);
      expect(blob).toBeInstanceOf(Blob);
      expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([7, 8]);
    });

    it("re-writing the same (taskType, inputs, port) resolves the newest bytes", async () => {
      const { repo } = await setup();
      await repo.saveOutputStreamPort!(
        "T",
        { k: 3 },
        "file",
        "binary",
        gen(new Uint8Array([1, 2, 3])),
        {}
      );
      const ref = await repo.saveOutputStreamPort!(
        "T",
        { k: 3 },
        "file",
        "binary",
        gen(new Uint8Array([9])),
        {}
      );
      expect(await collect((await repo.getOutputStreamByRef!(ref))!)).toEqual([9]);
    });

    it("returns undefined from both readers for an unknown ref", async () => {
      const { repo } = await setup();
      const ref = makeCacheRef({ $ref: "fsfolder://blobs/never-written.bin" });
      expect(await repo.getOutputByRef!(ref)).toBeUndefined();
      expect(repo.getOutputStreamByRef!(ref)).toBeUndefined();
    });

    it("clear() makes previously written refs dangle", async () => {
      const { repo } = await setup();
      const ref = await repo.saveOutputStreamPort!(
        "T",
        { k: 4 },
        "file",
        "binary",
        gen(new Uint8Array([1])),
        {}
      );
      await repo.clear();
      expect(await repo.getOutputByRef!(ref)).toBeUndefined();
      expect(repo.getOutputStreamByRef!(ref)).toBeUndefined();
    });

    it("a sibling instance over the same backing resolves the ref (cross-process)", async () => {
      const { repo, sibling } = await setup();
      if (!sibling) return; // in-memory backings have no cross-instance story
      const ref = await repo.saveOutputStreamPort!(
        "T",
        { k: 5 },
        "file",
        "binary",
        gen(new Uint8Array([4, 2])),
        {}
      );
      const other = sibling();
      expect(await collect((await other.getOutputStreamByRef!(ref))!)).toEqual([4, 2]);
      const blob = await other.getOutputByRef!(ref);
      expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([4, 2]);
    });
  });
}

runCacheStreamOutContractTests("StreamingMemoryRepo", async () => ({
  repo: new StreamingMemoryRepo({}),
}));

runCacheStreamOutContractTests("FsFolderTaskOutputRepository", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wg-cache-streamout-"));
  return {
    repo: new FsFolderTaskOutputRepository(folder),
    sibling: () => new FsFolderTaskOutputRepository(folder),
  };
});

describe("FsFolderTaskOutputRepository specifics", () => {
  it("publishes atomically: no .tmp file remains and the blob is named by the ref", async () => {
    const folder = await mkdtemp(join(tmpdir(), "wg-cache-streamout-"));
    const repo = new FsFolderTaskOutputRepository(folder);
    const ref = await repo.saveOutputStreamPort!(
      "My Task/v2",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([1])),
      {
        mime: "application/octet-stream",
      }
    );
    expect(ref.mime).toBe("application/octet-stream");
    const files = await readdir(join(folder, "blobs"));
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    expect(files).toHaveLength(1);
    expect(ref.$ref).toBe(`fsfolder://blobs/${files[0]}`);
    expect(existsSync(join(folder, "blobs", files[0]))).toBe(true);
  });

  it("rejects path-traversal shaped refs", async () => {
    const folder = await mkdtemp(join(tmpdir(), "wg-cache-streamout-"));
    const repo = new FsFolderTaskOutputRepository(folder);
    const evil = makeCacheRef({ $ref: "fsfolder://blobs/../../etc/passwd.bin" });
    expect(await repo.getOutputByRef!(evil)).toBeUndefined();
    expect(repo.getOutputStreamByRef!(evil)).toBeUndefined();
  });

  it("clearOlderThan prunes blob files alongside rows", async () => {
    const folder = await mkdtemp(join(tmpdir(), "wg-cache-streamout-"));
    const repo = new FsFolderTaskOutputRepository(folder);
    const ref = await repo.saveOutputStreamPort!(
      "T",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([1])),
      {}
    );
    // Negative age puts the cutoff in the future: everything is "older".
    await repo.clearOlderThan(-60_000);
    expect(repo.getOutputStreamByRef!(ref)).toBeUndefined();
  });

  it("task types with colliding sanitized names get distinct blobs", async () => {
    const folder = await mkdtemp(join(tmpdir(), "wg-cache-streamout-"));
    const repo = new FsFolderTaskOutputRepository(folder);
    // Both sanitize to "My-Task"; same inputs — only the fingerprinted raw
    // taskType keeps the blob files apart.
    const refA = await repo.saveOutputStreamPort!(
      "My@Task",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([1])),
      {}
    );
    const refB = await repo.saveOutputStreamPort!(
      "My/Task",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([2])),
      {}
    );
    expect(refA.$ref).not.toBe(refB.$ref);
    const a = new Uint8Array(await (await repo.getOutputByRef!(refA))!.arrayBuffer());
    const b = new Uint8Array(await (await repo.getOutputByRef!(refB))!.arrayBuffer());
    expect(Array.from(a)).toEqual([1]);
    expect(Array.from(b)).toEqual([2]);
  });
});
