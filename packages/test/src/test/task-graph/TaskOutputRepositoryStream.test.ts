/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CacheRef, TaskInput, TaskOutput } from "@workglow/task-graph";
import { makeCacheRef, RunPrivateCacheRepo, TaskOutputRepository } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

class StreamingMemoryRepo extends TaskOutputRepository {
  public readonly streamed = new Map<string, Uint8Array>();
  public readonly streamedMetadata = new Map<string, Record<string, unknown>>();
  private store = new Map<string, TaskOutput>();
  override async saveOutput(t: string, i: TaskInput, o: TaskOutput): Promise<void> {
    this.store.set(t + JSON.stringify(i), o);
  }
  override async getOutput(t: string, i: TaskInput): Promise<TaskOutput | undefined> {
    return this.store.get(t + JSON.stringify(i));
  }
  override async clear(): Promise<void> {
    this.store.clear();
    this.streamed.clear();
  }
  override async size(): Promise<number> {
    return this.store.size;
  }
  override async clearOlderThan(): Promise<void> {}
  override isDurable(): boolean {
    return false;
  }
  override async saveOutputStream(
    taskType: string,
    inputs: TaskInput,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    const parts: Uint8Array[] = [];
    for await (const c of chunks) parts.push(c);
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.byteLength;
    }
    const key = taskType + JSON.stringify(inputs);
    this.streamed.set(key, merged);
    this.streamedMetadata.set(key, metadata);
    return makeCacheRef({ $ref: `inmem://${key}`, size: total });
  }
  override async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    const key = ref.$ref.replace(/^inmem:\/\//, "");
    const bytes = this.streamed.get(key);
    return bytes === undefined ? undefined : new Blob([bytes as unknown as BlobPart]);
  }
  override getOutputStreamByRef(ref: CacheRef): AsyncIterable<Uint8Array> | undefined {
    const key = ref.$ref.replace(/^inmem:\/\//, "");
    const bytes = this.streamed.get(key);
    if (bytes === undefined) return undefined;
    return (async function* () {
      yield bytes;
    })();
  }
}

// A minimal repo that simply does NOT define `saveOutputStream`, so it has no
// streaming capability (no double-cast shadowing).
class NonStreamingMemoryRepo extends TaskOutputRepository {
  private store = new Map<string, TaskOutput>();
  override async saveOutput(t: string, i: TaskInput, o: TaskOutput): Promise<void> {
    this.store.set(t + JSON.stringify(i), o);
  }
  override async getOutput(t: string, i: TaskInput): Promise<TaskOutput | undefined> {
    return this.store.get(t + JSON.stringify(i));
  }
  override async clear(): Promise<void> {
    this.store.clear();
  }
  override async size(): Promise<number> {
    return this.store.size;
  }
  override async clearOlderThan(): Promise<void> {}
  override isDurable(): boolean {
    return false;
  }
}

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

describe("TaskOutputRepository.saveOutputStream", () => {
  it("supportsStreaming reflects presence of saveOutputStream", () => {
    expect(new StreamingMemoryRepo({}).supportsStreaming()).toBe(true);
    expect(new NonStreamingMemoryRepo({}).supportsStreaming()).toBe(false);
  });

  it("streams chunks and the total equals total bytes streamed", async () => {
    const repo = new StreamingMemoryRepo({});
    await repo.saveOutputStream(
      "T",
      { k: 1 },
      gen(new Uint8Array([1, 2]), new Uint8Array([3])),
      {}
    );
    expect(Array.from(repo.streamed.get('T{"k":1}')!)).toEqual([1, 2, 3]);
  });

  it("an empty stream stores a zero-length Uint8Array", async () => {
    const repo = new StreamingMemoryRepo({});
    await repo.saveOutputStream("T", { k: 1 }, gen(), {});
    const stored = repo.streamed.get('T{"k":1}')!;
    expect(stored).toBeInstanceOf(Uint8Array);
    expect(stored.byteLength).toBe(0);
  });

  it("passes the metadata arg through to the repo (side-band contract)", async () => {
    const repo = new StreamingMemoryRepo({});
    const metadata = { contentType: "application/octet-stream", status: 200 };
    await repo.saveOutputStream("T", { k: 1 }, gen(new Uint8Array([9])), metadata);
    expect(repo.streamedMetadata.get('T{"k":1}')).toEqual(metadata);
  });

  it("RunPrivateCacheRepo forwards streaming with namespaced taskType", async () => {
    const backing = new StreamingMemoryRepo({});
    const wrapper = new RunPrivateCacheRepo({ backing, runId: "run-A" });

    expect(wrapper.supportsStreaming()).toBe(true);

    await wrapper.saveOutputStream("T", { k: 1 }, gen(new Uint8Array([1, 2, 3])), {});

    // taskType is namespaced exactly as saveOutput namespaces it.
    const namespacedKey = `__run:run-A::T${JSON.stringify({ k: 1 })}`;
    expect(Array.from(backing.streamed.get(namespacedKey)!)).toEqual([1, 2, 3]);
    expect(backing.streamed.has('T{"k":1}')).toBe(false);
  });

  it("RunPrivateCacheRepo.supportsStreaming() is false when backing lacks it", () => {
    const backing = new NonStreamingMemoryRepo({});
    const wrapper = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    expect(wrapper.supportsStreaming()).toBe(false);
  });

  it("saveOutputStream returns a CacheRef the same backing can resolve to bytes", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { k: 1 }, gen(new Uint8Array([7, 8, 9])), {});
    expect(typeof ref.$ref).toBe("string");
    expect(ref.size).toBe(3);
    const hydrated = await repo.getOutputByRef(ref);
    expect(hydrated).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await hydrated!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([7, 8, 9]);
  });

  it("getOutputStreamByRef yields bytes for a saved ref", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { k: 2 }, gen(new Uint8Array([4, 5])), {});
    const stream = repo.getOutputStreamByRef(ref);
    expect(stream).toBeDefined();
    const collected: number[] = [];
    for await (const chunk of stream!) {
      for (const b of chunk) collected.push(b);
    }
    expect(collected).toEqual([4, 5]);
  });

  it("getOutputByRef returns undefined after clear (dangling reference)", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await repo.saveOutputStream("T", { k: 3 }, gen(new Uint8Array([1])), {});
    expect(await repo.getOutputByRef(ref)).toBeInstanceOf(Blob);
    await repo.clear();
    expect(await repo.getOutputByRef(ref)).toBeUndefined();
  });

  it("RunPrivateCacheRepo forwards getOutputByRef to backing", async () => {
    const backing = new StreamingMemoryRepo({});
    const wrapper = new RunPrivateCacheRepo({ backing, runId: "run-B" });
    const ref = await wrapper.saveOutputStream("T", { k: 4 }, gen(new Uint8Array([42])), {});
    const hydrated = await wrapper.getOutputByRef(ref);
    expect(hydrated).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await hydrated!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([42]);
  });
});
