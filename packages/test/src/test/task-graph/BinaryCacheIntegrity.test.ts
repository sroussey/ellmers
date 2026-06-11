/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { StreamEvent } from "@workglow/task-graph";
import {
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  FsFolderTaskOutputRepository,
  IExecuteContext,
  StreamPump,
  Task,
  TaskGraph,
  TaskGraphRunner,
} from "@workglow/task-graph";
import { Container, ServiceRegistry, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StreamingMemoryRepo } from "../../binding/StreamingMemoryRepo";

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
