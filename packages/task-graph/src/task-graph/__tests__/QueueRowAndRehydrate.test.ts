/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CacheRef,
  IExecuteContext,
  JobHandleLike,
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
  resolveJobOutput,
  Task,
  TaskOutputRepository,
  TaskRegistry,
} from "@workglow/task-graph";
import { Container, ServiceRegistry, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

type BinOut = { bytes: Blob };

/**
 * Streaming memory cache that exposes both `saveOutputStreamPort` (the ref sink
 * path: returns CacheRef + stores bytes in a side map) and `getOutputByRef` so the
 * cross-process resolution test below can hydrate refs without touching the
 * main `saveOutput` row.
 */
class StreamingMemoryRepo extends TaskOutputRepository {
  public readonly saved = new Map<string, TaskOutput>();
  public readonly streamed = new Map<string, Uint8Array>();
  override async saveOutput(t: string, i: TaskInput, o: TaskOutput): Promise<void> {
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

class NonStreamingMemoryRepo extends TaskOutputRepository {
  public readonly saved = new Map<string, TaskOutput>();
  override async saveOutput(t: string, i: TaskInput, o: TaskOutput): Promise<void> {
    this.saved.set(t + JSON.stringify(i), o);
  }
  override async getOutput(t: string, i: TaskInput): Promise<TaskOutput | undefined> {
    return this.saved.get(t + JSON.stringify(i));
  }
  override async clear(): Promise<void> {
    this.saved.clear();
  }
  override async size(): Promise<number> {
    return this.saved.size;
  }
  override async clearOlderThan(): Promise<void> {}
  override isDurable(): boolean {
    return false;
  }
}

const CHUNK = 4 * 1024; // 4 KiB
const CHUNKS = 16; // 64 KiB total — large enough that inline-vs-ref is dramatic

class BigBlobStreamTask extends Task<Record<string, never>, BinOut> {
  public static override type = "Spec2QueueRowTest_BigBlobStream";
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
    for (let i = 0; i < CHUNKS; i++) {
      const chunk = new Uint8Array(CHUNK).fill(i & 0xff);
      yield { type: "binary-delta", port: "bytes", binaryDelta: chunk };
      if (i % 4 === 3) await sleep(0);
    }
    yield { type: "finish", data: {} as BinOut };
  }
}

type ArrayBufOut = { bytes: ArrayBuffer };

class BigArrayBufferStreamTask extends Task<Record<string, never>, ArrayBufOut> {
  public static override type = "Spec2QueueRowTest_BigArrayBufferStream";
  public static override category = "Test";
  public static override cacheable = true;

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "binary", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<ArrayBufOut>> {
    for (let i = 0; i < CHUNKS; i++) {
      const chunk = new Uint8Array(CHUNK).fill(i & 0xff);
      yield { type: "binary-delta", port: "bytes", binaryDelta: chunk };
      if (i % 4 === 3) await sleep(0);
    }
    yield { type: "finish", data: {} as ArrayBufOut };
  }
}

beforeAll(() => {
  TaskRegistry.registerTask(BigBlobStreamTask as any);
  TaskRegistry.registerTask(BigArrayBufferStreamTask as any);
});

let services: ServiceRegistry;
let repo: StreamingMemoryRepo;
beforeEach(() => {
  repo = new StreamingMemoryRepo({});
  services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));
});

/**
 * The principal user value of result-as-reference: the SAVED ROW in the cache
 * (the same value job-queue would carry through `JobStorageFormat.output`) stays small
 * regardless of payload size when the ref path is taken. These tests measure
 * the wire size by JSON-serializing the saved output the way a real storage
 * backend (Postgres/SQLite) would.
 */
describe("saved-row size & cross-process rehydration", () => {
  it("force-ref keeps the saved row tiny (CacheRef envelope only); bytes live in the streaming cache", async () => {
    const task = new BigBlobStreamTask();
    const output = await task.run({}, { registry: services, referenceThresholdBytes: 0 });

    // Wire shape of the cached small row.
    expect(repo.saved.size).toBe(1);
    const [savedOutput] = Array.from(repo.saved.values()) as Array<Record<string, unknown>>;
    expect(isCacheRef(savedOutput.bytes)).toBe(true);

    const savedJson = JSON.stringify(savedOutput);
    // CacheRef envelope is well under 1 KiB regardless of payload size.
    expect(savedJson.length).toBeLessThan(1024);

    // Bytes are present in the streaming side of the cache (full size).
    const ref = savedOutput.bytes as CacheRef;
    expect(ref.size).toBe(CHUNKS * CHUNK);
    const hydrated = await repo.getOutputByRef(ref);
    expect(hydrated).toBeInstanceOf(Blob);
    expect(hydrated!.size).toBe(CHUNKS * CHUNK);

    // And Output's port slot is a ref (not a Blob).
    expect(isCacheRef(output.bytes)).toBe(true);
  });

  it("contrast: a non-streaming cache embeds the full payload in the saved row (the bloat path)", async () => {
    // Same task, but the cache cannot stream — the runner falls through to
    // accumulation and the saved row contains the serialized payload as a
    // JSON-safe BinaryPortWire envelope (the binary port codec), not a ref.
    const nonStreamRepo = new NonStreamingMemoryRepo({});
    const altServices = new ServiceRegistry(new Container());
    altServices.registerInstance(
      CACHE_REGISTRY,
      new DefaultCacheRegistry({ deterministic: nonStreamRepo })
    );

    const task = new BigBlobStreamTask();
    await task.run({}, { registry: altServices, referenceThresholdBytes: 0 });

    expect(nonStreamRepo.saved.size).toBe(1);
    const [savedOutput] = Array.from(nonStreamRepo.saved.values()) as Array<
      Record<string, unknown>
    >;
    expect(isCacheRef(savedOutput.bytes)).toBe(false);
    // The observable point: this row carries the (encoded) artifact itself,
    // not a reference — the full payload still bloats the row.
    const wire = savedOutput.bytes as Record<string, unknown>;
    expect(wire.__binaryPortWire).toBe(1);
    expect(wire.size).toBe(CHUNKS * CHUNK);
  });

  it("cross-process simulation: serialize the small row, deserialize elsewhere, resolveJobOutput against shared cache", async () => {
    const task = new BigBlobStreamTask();
    await task.run({}, { registry: services, referenceThresholdBytes: 0 });
    const [savedOutput] = Array.from(repo.saved.values()) as Array<Record<string, unknown>>;

    // "Process A" → wire: serialize the small row to a string (what Postgres
    // would store in JSONB / SQLite would store in TEXT for the JobStorageFormat
    // output column).
    const wire = JSON.stringify(savedOutput);
    expect(wire.length).toBeLessThan(1024);

    // "Process B" pulls the small row off the queue and reconstructs Output.
    // The CacheRef survives JSON round-trip unchanged (just data).
    const received = JSON.parse(wire) as { bytes: CacheRef };
    expect(isCacheRef(received.bytes)).toBe(true);

    // Process B resolves the ref against the SHARED cache (in real
    // deployments: S3, networked FS, shared Postgres) — here `repo` is the
    // shared backing for the test. resolveJobOutput is the queue-boundary
    // bridge that callers wrap their JobHandle in.
    const handle: JobHandleLike<{ bytes: Blob }> = {
      waitFor: async () => received as unknown as { bytes: Blob },
    };
    const resolved = await resolveJobOutput(handle, repo);

    expect(resolved.bytes).toBeInstanceOf(Blob);
    expect((resolved.bytes as Blob).size).toBe(CHUNKS * CHUNK);
  });

  it("rehydration below threshold inlines a Blob for format:'blob' (canonical BinaryFormat)", async () => {
    const task = new BigBlobStreamTask();
    // Threshold above the full payload → rehydrate inline.
    const output = await task.run(
      {},
      {
        registry: services,
        referenceThresholdBytes: CHUNKS * CHUNK + 1,
      }
    );
    expect(output.bytes).toBeInstanceOf(Blob);
    expect((output.bytes as Blob).size).toBe(CHUNKS * CHUNK);
  });

  it("rehydration below threshold inlines an ArrayBuffer for format:'binary' (canonical BinaryFormat)", async () => {
    const task = new BigArrayBufferStreamTask();
    const output = await task.run(
      {},
      {
        registry: services,
        referenceThresholdBytes: CHUNKS * CHUNK + 1,
      }
    );
    expect(output.bytes).toBeInstanceOf(ArrayBuffer);
    expect((output.bytes as ArrayBuffer).byteLength).toBe(CHUNKS * CHUNK);
  });

  it("dangling refs (cache cleared between save and read) resolve to undefined — best-effort contract", async () => {
    const task = new BigBlobStreamTask();
    await task.run({}, { registry: services, referenceThresholdBytes: 0 });
    const [savedOutput] = Array.from(repo.saved.values()) as Array<Record<string, unknown>>;

    // Cache TTL expired / explicit clear / different deployment with no
    // backing access — the ref now points nowhere.
    await repo.clear();

    const handle: JobHandleLike<{ bytes: Blob }> = {
      waitFor: async () => savedOutput as unknown as { bytes: Blob },
    };
    const resolved = await resolveJobOutput(handle, repo);
    // Resolution is best-effort: a dangling ref resolves to undefined.
    expect(resolved.bytes).toBeUndefined();
  });
});
