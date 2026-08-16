/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { RunPrivateCacheRepo } from "@workglow/task-graph";
import { NonStreamingMemoryRepo, StreamingMemoryRepo } from "@workglow/task-graph/test";
import { describe, expect, it } from "vitest";

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

describe("TaskOutputRepository.saveOutputStreamPort", () => {
  it("supportsStreaming reflects presence of saveOutputStreamPort", () => {
    expect(new StreamingMemoryRepo({}).supportsStreaming()).toBe(true);
    expect(new NonStreamingMemoryRepo({}).supportsStreaming()).toBe(false);
  });

  it("streams chunks and the total equals total bytes streamed", async () => {
    const repo = new StreamingMemoryRepo({});
    await repo.saveOutputStreamPort(
      "T",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([1, 2]), new Uint8Array([3])),
      {}
    );
    expect(Array.from(repo.streamed.get('T{"k":1}#file')!)).toEqual([1, 2, 3]);
  });

  it("an empty stream stores a zero-length Uint8Array", async () => {
    const repo = new StreamingMemoryRepo({});
    await repo.saveOutputStreamPort("T", { k: 1 }, "file", "binary", gen(), {});
    const stored = repo.streamed.get('T{"k":1}#file')!;
    expect(stored).toBeInstanceOf(Uint8Array);
    expect(stored.byteLength).toBe(0);
  });

  it("passes the metadata arg through to the repo (side-band contract)", async () => {
    const repo = new StreamingMemoryRepo({});
    const metadata = { contentType: "application/octet-stream", status: 200 };
    await repo.saveOutputStreamPort(
      "T",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([9])),
      metadata
    );
    expect(repo.streamedMetadata.get('T{"k":1}#file')).toEqual(metadata);
  });

  it("RunPrivateCacheRepo does not forward streaming (run-private is not stream-capable)", () => {
    // Run scoping is delegated to the backing's run-scoped row methods; the
    // streaming sink is a deterministic-cache capability, so the wrapper does
    // not expose it regardless of the backing.
    const backing = new StreamingMemoryRepo({});
    const wrapper = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    expect(wrapper.supportsStreaming()).toBe(false);
    expect(typeof (wrapper as { saveOutputStreamPort?: unknown }).saveOutputStreamPort).not.toBe(
      "function"
    );
  });

  it("saveOutputStreamPort returns a CacheRef the same backing can resolve to bytes", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 1 },
      "file",
      "binary",
      gen(new Uint8Array([7, 8, 9])),
      {}
    );
    expect(typeof ref.$ref).toBe("string");
    expect(ref.size).toBe(3);
    const hydrated = await repo.getOutputByRef(ref);
    expect(hydrated).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await hydrated!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([7, 8, 9]);
  });

  it("getOutputStreamByRef yields bytes for a saved ref", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 2 },
      "file",
      "binary",
      gen(new Uint8Array([4, 5])),
      {}
    );
    const stream = await repo.getOutputStreamByRef(ref);
    expect(stream).toBeDefined();
    const collected: number[] = [];
    for await (const chunk of stream!) {
      for (const b of chunk) collected.push(b);
    }
    expect(collected).toEqual([4, 5]);
  });

  it("getOutputByRef returns undefined after clear (dangling reference)", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStreamPort(
      "T",
      { k: 3 },
      "file",
      "binary",
      gen(new Uint8Array([1])),
      {}
    );
    expect(await repo.getOutputByRef(ref)).toBeInstanceOf(Blob);
    await repo.clear();
    expect(await repo.getOutputByRef(ref)).toBeUndefined();
  });
});
