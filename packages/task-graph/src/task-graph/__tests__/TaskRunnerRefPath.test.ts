/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CacheRef,
  IExecuteContext,
  StreamEvent,
  StreamMode,
  TaskInput,
  TaskOutput,
} from "@workglow/task-graph";
import {
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  isCacheRef,
  makeCacheRef,
  Task,
  TaskOutputRepository,
  TaskRegistry,
} from "@workglow/task-graph";
import { Container, ServiceRegistry, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

type BinOut = { bytes: Blob | ArrayBuffer };

class StreamingMemoryRepo extends TaskOutputRepository {
  public readonly saved = new Map<string, TaskOutput>();
  public readonly streamed = new Map<string, Uint8Array>();
  public saveOutputCalls = 0;
  public saveOutputStreamCalls = 0;

  override async saveOutput(t: string, i: TaskInput, o: TaskOutput): Promise<void> {
    this.saveOutputCalls++;
    this.saved.set(t + JSON.stringify(i), o);
  }
  override async getOutput(t: string, i: TaskInput): Promise<TaskOutput | undefined> {
    return this.saved.get(t + JSON.stringify(i));
  }
  override async clear(): Promise<void> {
    this.saved.clear();
    this.streamed.clear();
  }
  override async size(): Promise<number> {
    return this.saved.size;
  }
  override async clearOlderThan(): Promise<void> {}
  override isDurable(): boolean {
    return false;
  }
  override async saveOutputStreamPort(
    taskType: string,
    inputs: TaskInput,
    port: string,
    mode: StreamMode,
    chunks: AsyncIterable<Uint8Array>,
    _metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    this.saveOutputStreamCalls++;
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const c of chunks) {
      parts.push(c);
      size += c.byteLength;
    }
    const merged = new Uint8Array(size);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.byteLength;
    }
    const key = `inmem://${taskType}::${JSON.stringify(inputs)}::${port}`;
    this.streamed.set(key, merged);
    return makeCacheRef({ $ref: key, port, mode, size, mime: "application/octet-stream" });
  }
  override async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    const bytes = this.streamed.get(ref.$ref);
    return bytes === undefined ? undefined : new Blob([bytes as unknown as BlobPart]);
  }
}

class BlobStreamTask extends Task<Record<string, never>, BinOut> {
  public static override type = "TaskRunnerRefPathTest_BlobStream";
  public static override category = "Test";
  public static override cacheable = true;

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "blob", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<BinOut>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2, 3]) };
    await sleep(1);
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([4, 5]) };
    yield { type: "finish", data: {} as BinOut };
  }
}

class NonCacheableBlobStreamTask extends BlobStreamTask {
  public static override type = "TaskRunnerRefPathTest_NonCacheableBlobStream";
  public static override cacheable = false;
}

beforeAll(() => {
  TaskRegistry.registerTask(BlobStreamTask as any);
  TaskRegistry.registerTask(NonCacheableBlobStreamTask as any);
});

let repo: StreamingMemoryRepo;
let services: ServiceRegistry;
beforeEach(() => {
  repo = new StreamingMemoryRepo({});
  services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));
});

describe("TaskRunner — referenceThresholdBytes: 0 (force-ref) ref path", () => {
  it("Output carries a CacheRef at the binary port; bytes live in the streaming cache", async () => {
    const task = new BlobStreamTask();
    const output = await task.run({}, { registry: services, referenceThresholdBytes: 0 });

    expect(repo.saveOutputStreamCalls).toBe(1);
    expect(isCacheRef(output.bytes)).toBe(true);

    const ref = output.bytes as unknown as CacheRef;
    const hydrated = await repo.getOutputByRef(ref);
    expect(hydrated).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await hydrated!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(ref.size).toBe(5);
  });

  it("saveOutput still runs (small Output with embedded ref → small queue/cache row)", async () => {
    const task = new BlobStreamTask();
    await task.run({}, { registry: services, referenceThresholdBytes: 0 });

    expect(repo.saveOutputCalls).toBe(1);
    // The cached small row contains the ref, NOT the bytes.
    const [savedOutput] = Array.from(repo.saved.values());
    expect(isCacheRef((savedOutput as any).bytes)).toBe(true);
  });

  it("defaults (threshold 64 KiB) produce inline Blob in Output — small outputs rehydrate", async () => {
    const task = new BlobStreamTask();
    const output = await task.run({}, { registry: services });

    // D.4: sink runs unconditionally when cache supports streaming; the
    // rehydrate step converts the ref back to an inline Blob because total
    // bytes (5) is below the 64 KiB default threshold.
    expect(repo.saveOutputStreamCalls).toBe(1);
    expect(output.bytes).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await (output.bytes as Blob).arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("non-cacheable tasks fall through to accumulation even with threshold=0", async () => {
    const task = new NonCacheableBlobStreamTask();
    const output = await task.run({}, { registry: services, referenceThresholdBytes: 0 });

    expect(repo.saveOutputStreamCalls).toBe(0);
    expect(output.bytes).toBeInstanceOf(Blob);
  });
});

describe("TaskRunner — Phase D.4 threshold-based size decision", () => {
  it("output below threshold is rehydrated to an inline Blob (sink still ran for memory bound)", async () => {
    const task = new BlobStreamTask();
    // Threshold well above the 5 bytes the task produces → rehydrate inline.
    const output = await task.run({}, { registry: services, referenceThresholdBytes: 100 });

    expect(repo.saveOutputStreamCalls).toBe(1); // sink ran (memory-bounded write)
    expect(output.bytes).toBeInstanceOf(Blob); // but the slot is now an inline Blob
    const bytes = new Uint8Array(await (output.bytes as Blob).arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("output at or above threshold keeps the CacheRef", async () => {
    const task = new BlobStreamTask();
    // 5 bytes >= threshold 5 → ref survives.
    const output = await task.run({}, { registry: services, referenceThresholdBytes: 5 });

    expect(repo.saveOutputStreamCalls).toBe(1);
    expect(isCacheRef(output.bytes)).toBe(true);
    expect((output.bytes as unknown as CacheRef).size).toBe(5);
  });

  it("threshold=0 (force-ref) overrides the size check; the ref survives regardless", async () => {
    const task = new BlobStreamTask();
    const output = await task.run({}, { registry: services, referenceThresholdBytes: 0 });

    expect(repo.saveOutputStreamCalls).toBe(1);
    expect(isCacheRef(output.bytes)).toBe(true);
  });

  it("default threshold (64 KiB) rehydrates the small-output path automatically", async () => {
    const task = new BlobStreamTask();
    // No threshold specified → resolves to 64 KiB default; 5 bytes is below.
    const output = await task.run({}, { registry: services });

    expect(repo.saveOutputStreamCalls).toBe(1); // sink now always runs when cache supports it
    expect(output.bytes).toBeInstanceOf(Blob);
  });
});

describe("TaskRunner — orphan blob cleanup on row-save failure", () => {
  it("deletes the streamed blob when saveOutput throws so the ref does not leak", async () => {
    class FailingRepo extends StreamingMemoryRepo {
      public deletedRefs: CacheRef[] = [];
      override async saveOutput(): Promise<void> {
        throw new Error("row write failed");
      }
      override async deleteOutputByRef(ref: CacheRef): Promise<void> {
        this.deletedRefs.push(ref);
        this.streamed.delete(ref.$ref);
      }
    }
    const failing = new FailingRepo({});
    const failingServices = new ServiceRegistry(new Container());
    failingServices.registerInstance(
      CACHE_REGISTRY,
      new DefaultCacheRegistry({ deterministic: failing })
    );
    const task = new BlobStreamTask();
    await expect(
      task.run({}, { registry: failingServices, referenceThresholdBytes: 0 })
    ).rejects.toThrow("row write failed");

    // Sink wrote the blob, but the row commit failed — the runner should
    // have asked the repo to delete the orphan blob before re-throwing.
    expect(failing.saveOutputStreamCalls).toBe(1);
    expect(failing.deletedRefs.length).toBe(1);
    expect(failing.streamed.size).toBe(0);
  });
});
