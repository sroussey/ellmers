/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import {
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  FsFolderTaskOutputRepository,
  isCacheRef,
  StreamPump,
  Task,
  TaskGraph,
  TaskGraphRunner,
} from "@workglow/task-graph";
import { InMemoryTaskOutputRepository, StreamingMemoryRepo } from "@workglow/task-graph/test";
import { Container, ServiceRegistry, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function blobBytes(value: unknown): Promise<number[]> {
  expect(value).toBeInstanceOf(Blob);
  return Array.from(new Uint8Array(await (value as Blob).arrayBuffer()));
}

type SmallOut = { bytes: Blob | ArrayBuffer };

let smallExecutions = 0;

/** Small (5-byte) binary producer — well below the default 64 KiB threshold. */
class SmallBlobStreamTask extends Task<Record<string, never>, SmallOut> {
  public static override type = "BinaryCacheIntegrity_Small";
  public static override category = "Test";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

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
  ): AsyncIterable<StreamEvent<SmallOut>> {
    smallExecutions++;
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2, 3]) };
    await sleep(1);
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([4, 5]) };
    yield { type: "finish", data: {} as SmallOut };
  }
}

type TwoPortOut = { a: Blob | ArrayBuffer; b: Blob | ArrayBuffer };

/** Streams two independent binary ports in one run. */
class TwoPortBinarySource extends Task<Record<string, never>, TwoPortOut> {
  public static override type = "BinaryCacheIntegrity_TwoPort";
  public static override category = "Test";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: { type: "object", format: "blob", "x-stream": "binary" },
        b: { type: "object", format: "blob", "x-stream": "binary" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<TwoPortOut>> {
    yield { type: "binary-delta", port: "a", binaryDelta: new Uint8Array([1, 2]) };
    yield { type: "binary-delta", port: "b", binaryDelta: new Uint8Array([9, 8, 7]) };
    yield { type: "finish", data: {} as TwoPortOut };
  }
}

describe("binary cache integrity", () => {
  it("default-threshold small outputs survive a tabular (JSON-row) cache round-trip", async () => {
    smallExecutions = 0;
    const folder = await mkdtemp(join(tmpdir(), "wg-cache-integrity-"));
    const repo = new FsFolderTaskOutputRepository(folder);
    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));

    const out1 = await new SmallBlobStreamTask().run({}, { registry: services });
    expect(await blobBytes(out1.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(smallExecutions).toBe(1);

    // Second run must be a cache hit AND return the original bytes — not a
    // JSON-mangled `{}` from stringifying an inline Blob into the row.
    const out2 = await new SmallBlobStreamTask().run({}, { registry: services });
    expect(smallExecutions).toBe(1);
    expect(await blobBytes(out2.bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("multi-binary-port tasks fall back to accumulation — no port is dropped", async () => {
    const repo = new StreamingMemoryRepo({});

    const graph = new TaskGraph();
    const source = new TwoPortBinarySource({ id: "source" });
    graph.addTask(source);
    // Legacy direct-cache config: this is the path where taskNeedsAccumulation
    // consults canStreamBinaryToCache and may skip accumulation entirely.
    const results = await new TaskGraphRunner(graph).runGraph({}, { outputCache: repo });

    const data = results.find((r) => r.id === "source")!.data as TwoPortOut;
    expect(await blobBytes(data.a)).toEqual([1, 2]);
    expect(await blobBytes(data.b)).toEqual([9, 8, 7]);
  });

  it("canStreamBinaryToCache rejects tasks with more than one binary port", () => {
    const graph = new TaskGraph();
    const source = new TwoPortBinarySource({ id: "source" });
    graph.addTask(source);
    expect(StreamPump.canStreamBinaryToCache(graph, source, new StreamingMemoryRepo({}))).toBe(
      false
    );
  });
});

type InlineOut = { bytes: Blob | ArrayBuffer };

let inlineBlobExecutions = 0;

/** Non-streaming binary producer: plain execute() returning an inline Blob. */
class InlineBlobTask extends Task<Record<string, never>, InlineOut> {
  public static override type = "BinaryCacheIntegrity_InlineBlob";
  public static override category = "Test";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "blob" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<InlineOut> {
    inlineBlobExecutions++;
    return {
      bytes: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/octet-stream" }),
    };
  }
}

let inlineBufferExecutions = 0;

/** Non-streaming binary producer returning an inline ArrayBuffer. */
class InlineBufferTask extends Task<Record<string, never>, InlineOut> {
  public static override type = "BinaryCacheIntegrity_InlineBuffer";
  public static override category = "Test";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<InlineOut> {
    inlineBufferExecutions++;
    return { bytes: new Uint8Array([5, 6, 7]).buffer };
  }
}

describe("inline binary cache serialization (BinaryPortCodec)", () => {
  it("Blob round-trips through a non-streaming JSON-row backing", async () => {
    inlineBlobExecutions = 0;
    const repo = new InMemoryTaskOutputRepository();
    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));

    const out1 = await new InlineBlobTask().run({}, { registry: services });
    expect(await blobBytes(out1.bytes)).toEqual([1, 2, 3, 4]);
    expect(inlineBlobExecutions).toBe(1);

    const out2 = await new InlineBlobTask().run({}, { registry: services });
    expect(inlineBlobExecutions).toBe(1); // cache hit
    expect(await blobBytes(out2.bytes)).toEqual([1, 2, 3, 4]);
    expect((out2.bytes as Blob).type).toBe("application/octet-stream");
  });

  it("ArrayBuffer round-trips through a non-streaming JSON-row backing", async () => {
    inlineBufferExecutions = 0;
    const repo = new InMemoryTaskOutputRepository();
    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));

    const out1 = await new InlineBufferTask().run({}, { registry: services });
    expect(out1.bytes).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(out1.bytes as ArrayBuffer))).toEqual([5, 6, 7]);

    const out2 = await new InlineBufferTask().run({}, { registry: services });
    expect(inlineBufferExecutions).toBe(1); // cache hit
    expect(out2.bytes).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(out2.bytes as ArrayBuffer))).toEqual([5, 6, 7]);
  });

  it("streaming backings still store a CacheRef row, not a BinaryPortWire", async () => {
    const repo = new StreamingMemoryRepo({});
    const services = new ServiceRegistry(new Container());
    services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));

    await new SmallBlobStreamTask().run({}, { registry: services, referenceThresholdBytes: 0 });

    const rows = Array.from(
      (repo as unknown as { store: Map<string, Record<string, unknown>> }).store.values()
    );
    // StreamingMemoryRepo stores rows verbatim; the binary port slot must be
    // the branded ref envelope — the codec passes refs through untouched.
    expect(rows).toHaveLength(1);
    expect(isCacheRef(rows[0].bytes)).toBe(true);
    expect((rows[0].bytes as Record<string, unknown>).__binaryPortWire).toBeUndefined();
  });
});
