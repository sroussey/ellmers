/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Binary output ports stream straight to the cache on the UNFLAGGED path — for
 * any number of them, not just one. The memory win of piping bytes to a sink
 * instead of buffering them scales with how many large artifacts a task
 * produces, so a two-artifact producer is exactly the task that should not be
 * forced back onto full in-memory accumulation.
 *
 * What is pinned here:
 *
 * - the decision (`canStreamBinaryToCache`) for one, two and three binary ports;
 * - that binary-ONLY is still required — a task mixing a binary port with an
 *   `append` port keeps accumulating, because only binary ports get sinks and
 *   the append port would otherwise have neither sink nor accumulator;
 * - the live run: one distinct blob per port, `CacheRef`s each naming their own
 *   port, and both values correct on a replayed cache hit;
 * - the all-or-nothing ref invariant, extended to the multi-binary case this
 *   widening makes reachable without the `noAccumulation` flag.
 */

import type { CacheRef, StreamEvent } from "@workglow/task-graph";
import {
  Dataflow,
  isCacheRef,
  StreamPump,
  Task,
  TaskGraph,
  TaskGraphRunner,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { StreamingMemoryRepo } from "../../testing/StreamingMemoryRepo";

type TwoBinaryOut = { a: Blob | ArrayBuffer; b: Blob | ArrayBuffer };

const A_BYTES = [1, 2, 3];
const B_BYTES = [9, 8, 7, 6];

let twoPortRuns = 0;

/** Cacheable leaf streaming two independent binary artifacts in one run. */
class TwoBinaryPortSource extends Task<Record<string, never>, TwoBinaryOut> {
  public static override type = "MultiBinaryPortCacheStream_TwoPort";
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
  async *executeStream(): AsyncIterable<StreamEvent<TwoBinaryOut>> {
    twoPortRuns++;
    yield { type: "binary-delta", port: "a", binaryDelta: new Uint8Array(A_BYTES) };
    yield { type: "binary-delta", port: "b", binaryDelta: new Uint8Array(B_BYTES) };
    yield { type: "finish", data: {} as TwoBinaryOut };
  }
}

type ThreeBinaryOut = { a: Blob | ArrayBuffer; b: Blob | ArrayBuffer; c: Blob | ArrayBuffer };

/** Three binary ports — the old cap was `=== 1`, so two must not be a special case. */
class ThreeBinaryPortSource extends Task<Record<string, never>, ThreeBinaryOut> {
  public static override type = "MultiBinaryPortCacheStream_ThreePort";
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
        c: { type: "object", format: "blob", "x-stream": "binary" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<ThreeBinaryOut>> {
    yield { type: "binary-delta", port: "a", binaryDelta: new Uint8Array([1]) };
    yield { type: "binary-delta", port: "b", binaryDelta: new Uint8Array([2]) };
    yield { type: "binary-delta", port: "c", binaryDelta: new Uint8Array([3]) };
    yield { type: "finish", data: {} as ThreeBinaryOut };
  }
}

type OneBinaryOut = { bytes: Blob | ArrayBuffer };

/** The common case, pinned so the widening cannot disturb it. */
class OneBinaryPortSource extends Task<Record<string, never>, OneBinaryOut> {
  public static override type = "MultiBinaryPortCacheStream_OnePort";
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
  async *executeStream(): AsyncIterable<StreamEvent<OneBinaryOut>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([4, 5]) };
    yield { type: "finish", data: {} as OneBinaryOut };
  }
}

type MixedOut = { a: Blob | ArrayBuffer; t: string };

/**
 * Binary + `append`: the append port gets no binary sink, so skipping
 * accumulation would leave its deltas with nowhere to go.
 */
class MixedModeSource extends Task<Record<string, never>, MixedOut> {
  public static override type = "MultiBinaryPortCacheStream_Mixed";
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
        t: { type: "string", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<MixedOut>> {
    yield { type: "binary-delta", port: "a", binaryDelta: new Uint8Array([1, 2]) };
    yield { type: "text-delta", port: "t", textDelta: "hello" };
    yield { type: "finish", data: {} as MixedOut };
  }
}

type BinarySinkOut = { size: number };

/**
 * Materializing consumer: its `bytes` input port declares no `x-stream`, so the
 * edge needs the settled value. Used to engage the cache-hit replay path, which
 * is where the all-or-nothing ref invariant is enforced.
 */
class BinarySink extends Task<{ bytes: Blob | ArrayBuffer }, BinarySinkOut> {
  public static override type = "MultiBinaryPortCacheStream_Sink";
  public static override category = "Test";
  public static override cacheable = false;
  public static override inputSchema(): DataPortSchema {
    // No `type` constraint (accepts the materialized Blob at runtime) and NO
    // `x-stream` ⇒ a non-streaming consumer that needs the value at the edge.
    return {
      type: "object",
      properties: { bytes: { title: "Bytes", description: "materialized binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { size: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async execute(input: { bytes: Blob | ArrayBuffer }): Promise<BinarySinkOut> {
    const blob = input.bytes as Blob;
    return { size: (await blob.arrayBuffer()).byteLength };
  }
}

/** Two binary ports, each feeding a materializing consumer. */
function consumedGraph(): TaskGraph {
  const source = new TwoBinaryPortSource({ id: "source" });
  source.runConfig = { ...source.runConfig, referenceThresholdBytes: 0 };
  const graph = new TaskGraph();
  graph.addTasks([source, new BinarySink({ id: "sinkA" }), new BinarySink({ id: "sinkB" })]);
  graph.addDataflow(new Dataflow("source", "a", "sinkA", "bytes"));
  graph.addDataflow(new Dataflow("source", "b", "sinkB", "bytes"));
  return graph;
}

function sinkSizes(results: Array<{ id: unknown; data: unknown }>): [number, number] {
  const a = (results.find((r) => r.id === "sinkA")!.data as BinarySinkOut).size;
  const b = (results.find((r) => r.id === "sinkB")!.data as BinarySinkOut).size;
  return [a, b];
}

/** Single-task graph, optionally forcing every ref to survive (`threshold: 0`). */
function leafGraph(task: Task<any, any>, thresholdBytes?: number | undefined): TaskGraph {
  if (thresholdBytes !== undefined) {
    task.runConfig = { ...task.runConfig, referenceThresholdBytes: thresholdBytes };
  }
  const graph = new TaskGraph();
  graph.addTask(task);
  return graph;
}

function decisionFor(task: Task<any, any>): boolean {
  return StreamPump.canStreamBinaryToCache(leafGraph(task), task, new StreamingMemoryRepo({}));
}

async function blobBytes(value: unknown): Promise<number[]> {
  expect(value).toBeInstanceOf(Blob);
  return Array.from(new Uint8Array(await (value as Blob).arrayBuffer()));
}

async function refBytes(cache: StreamingMemoryRepo, ref: unknown): Promise<number[]> {
  expect(isCacheRef(ref)).toBe(true);
  const blob = await cache.getOutputByRef(ref as CacheRef);
  expect(blob).toBeInstanceOf(Blob);
  return Array.from(new Uint8Array(await blob!.arrayBuffer()));
}

function sourceData(results: Array<{ id: unknown; data: unknown }>): Record<string, unknown> {
  return results.find((r) => r.id === "source")!.data as Record<string, unknown>;
}

describe("canStreamBinaryToCache — one or more binary ports", () => {
  it("accepts a single binary port (unchanged common case)", () => {
    expect(decisionFor(new OneBinaryPortSource({ id: "source" }))).toBe(true);
  });

  it("accepts two binary ports", () => {
    expect(decisionFor(new TwoBinaryPortSource({ id: "source" }))).toBe(true);
  });

  it("accepts three binary ports", () => {
    expect(decisionFor(new ThreeBinaryPortSource({ id: "source" }))).toBe(true);
  });

  it("still rejects a binary port mixed with a non-binary streaming port", () => {
    expect(decisionFor(new MixedModeSource({ id: "source" }))).toBe(false);
  });
});

describe("multi-binary-port cache streaming (no noAccumulation flag)", () => {
  let cache: StreamingMemoryRepo;

  beforeEach(() => {
    cache = new StreamingMemoryRepo({});
    twoPortRuns = 0;
  });

  it("writes one distinct blob and one port-bearing ref per binary port", async () => {
    const results = await new TaskGraphRunner(
      leafGraph(new TwoBinaryPortSource({ id: "source" }), 0)
    ).runGraph({}, { outputCache: cache });

    expect(cache.streamed.size).toBe(2);

    const data = sourceData(results);
    expect(isCacheRef(data.a)).toBe(true);
    expect(isCacheRef(data.b)).toBe(true);
    const refA = data.a as CacheRef;
    const refB = data.b as CacheRef;
    // Distinct blobs, each self-describing its port (the ref key carries it).
    expect(refA.$ref).not.toBe(refB.$ref);
    expect(refA.port).toBe("a");
    expect(refB.port).toBe("b");

    expect(await refBytes(cache, refA)).toEqual(A_BYTES);
    expect(await refBytes(cache, refB)).toEqual(B_BYTES);
  });

  it("streams three binary ports to three distinct blobs", async () => {
    const results = await new TaskGraphRunner(
      leafGraph(new ThreeBinaryPortSource({ id: "source" }), 0)
    ).runGraph({}, { outputCache: cache });

    expect(cache.streamed.size).toBe(3);
    const data = sourceData(results);
    expect(await refBytes(cache, data.a)).toEqual([1]);
    expect(await refBytes(cache, data.b)).toEqual([2]);
    expect(await refBytes(cache, data.c)).toEqual([3]);
  });

  it("rehydrates both ports below the threshold and replays them on a cache hit", async () => {
    const first = await new TaskGraphRunner(
      leafGraph(new TwoBinaryPortSource({ id: "source" }))
    ).runGraph({}, { outputCache: cache });
    expect(twoPortRuns).toBe(1);
    expect(cache.streamed.size).toBe(2);
    const firstData = first.find((r) => r.id === "source")!.data as TwoBinaryOut;
    expect(await blobBytes(firstData.a)).toEqual(A_BYTES);
    expect(await blobBytes(firstData.b)).toEqual(B_BYTES);

    const second = await new TaskGraphRunner(
      leafGraph(new TwoBinaryPortSource({ id: "source" }))
    ).runGraph({}, { outputCache: cache });
    expect(twoPortRuns).toBe(1); // served from cache
    const secondData = second.find((r) => r.id === "source")!.data as TwoBinaryOut;
    expect(await blobBytes(secondData.a)).toEqual(A_BYTES);
    expect(await blobBytes(secondData.b)).toEqual(B_BYTES);
  });

  it("tees to both sinks: materializing consumers still get one blob per port", async () => {
    const results = await new TaskGraphRunner(consumedGraph()).runGraph({}, { outputCache: cache });

    // A materializing consumer gates SKIPPING accumulation, not writing to
    // cache — both ports are still written, one blob each.
    expect(cache.streamed.size).toBe(2);
    expect(sinkSizes(results)).toEqual([A_BYTES.length, B_BYTES.length]);
  });

  it("treats one evicted binary blob of two as a whole-entry miss", async () => {
    await new TaskGraphRunner(consumedGraph()).runGraph({}, { outputCache: cache });
    expect(twoPortRuns).toBe(1);
    expect(cache.streamed.size).toBe(2);

    // Drop only port b's bytes; the row keeps BOTH refs.
    const bKey = [...cache.streamed.keys()].find((k) => k.endsWith("#b"))!;
    expect(cache.streamed.delete(bKey)).toBe(true);

    const results = await new TaskGraphRunner(consumedGraph()).runGraph({}, { outputCache: cache });

    // Recomputed rather than replaying a hole at b alongside a stale value at a.
    expect(twoPortRuns).toBe(2);
    expect(sinkSizes(results)).toEqual([A_BYTES.length, B_BYTES.length]);
  });

  it("replays both ports to their consumers on a full multi-binary hit", async () => {
    await new TaskGraphRunner(consumedGraph()).runGraph({}, { outputCache: cache });
    expect(twoPortRuns).toBe(1);

    const hit = await new TaskGraphRunner(consumedGraph()).runGraph({}, { outputCache: cache });
    expect(twoPortRuns).toBe(1); // served entirely from cache
    expect(sinkSizes(hit)).toEqual([A_BYTES.length, B_BYTES.length]);
  });

  it("keeps accumulating when a non-binary streaming port is present", async () => {
    const results = await new TaskGraphRunner(
      leafGraph(new MixedModeSource({ id: "source" }))
    ).runGraph({}, { outputCache: cache });

    const data = sourceData(results);
    // The append port keeps its accumulated value — no silently dropped deltas.
    expect(data.t).toBe("hello");
    expect(await blobBytes(data.a)).toEqual([1, 2]);
  });

  it("leaves the single-binary-port path byte-identical", async () => {
    const results = await new TaskGraphRunner(
      leafGraph(new OneBinaryPortSource({ id: "source" }))
    ).runGraph({}, { outputCache: cache });

    expect(cache.streamed.size).toBe(1);
    const data = sourceData(results);
    expect(await blobBytes(data.bytes)).toEqual([4, 5]);
  });
});
