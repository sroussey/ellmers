/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * No-accumulation passthrough coverage beyond the single-port case:
 *
 * - **Mixed-mode**: one source with an `append` port and an `object` port,
 *   each feeding its own same-mode passthrough consumer. Each port gets its
 *   own gate: a slow object consumer bounds the producer's lead on the object
 *   port while the fast text consumer's port flows freely — pacing is
 *   per-port, not per-task.
 *
 * - **Fan-out**: a single source port feeding TWO same-mode consumers is NOT
 *   a passthrough edge (the predicate requires a single consumer of the source
 *   port), so it falls back to the tee'd drain: correct, in-order delivery to
 *   both consumers, but only best-effort pacing (no precise gate).
 */

import type {
  CacheRef,
  IExecuteContext,
  StreamEvent,
  TaskInput,
  TaskOutput,
} from "@workglow/task-graph";
import {
  Dataflow,
  isCacheRef,
  makeCacheRef,
  StreamPump,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskOutputRepository,
} from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CHUNKS = 30;
const TEXT_CHUNK = "abcdefgh"; // 8 bytes per text delta
const HIGH_WATER = 256;

// --------------------------------------------------------------------------
// Streaming-port in-memory cache (per-port byte streams keyed by task+inputs).
// --------------------------------------------------------------------------
class StreamPortMemoryRepo extends TaskOutputRepository {
  public savePortCalls: Array<{ port: string; mode: string }> = [];
  private rows = new Map<string, TaskOutput>();
  private blobs = new Map<string, Uint8Array>();

  constructor() {
    super({ outputCompression: false });
  }
  override async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput) {
    this.rows.set(taskType + JSON.stringify(inputs), output);
  }
  override async getOutput(taskType: string, inputs: TaskInput) {
    return this.rows.get(taskType + JSON.stringify(inputs));
  }
  override async clear() {
    this.rows.clear();
    this.blobs.clear();
  }
  override async size() {
    return this.rows.size;
  }
  override async clearOlderThan() {}
  override isDurable() {
    return false;
  }

  override async saveOutputStreamPort(
    taskType: string,
    inputs: TaskInput,
    port: string,
    mode: string,
    chunks: AsyncIterable<Uint8Array>,
    _metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    this.savePortCalls.push({ port, mode });
    const parts: number[] = [];
    for await (const c of chunks) for (const b of c) parts.push(b);
    const bytes = Uint8Array.from(parts);
    const key = `inmem://${taskType}::${JSON.stringify(inputs)}::${port}`;
    this.blobs.set(key, bytes);
    return makeCacheRef({
      $ref: key,
      port,
      mode: mode as CacheRef["mode"],
      size: bytes.byteLength,
    });
  }
  override async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    const bytes = this.blobs.get(ref.$ref);
    return bytes === undefined ? undefined : new Blob([bytes as Uint8Array<ArrayBuffer>]);
  }
  override getOutputStreamByRef(ref: CacheRef): AsyncIterable<Uint8Array> | undefined {
    const bytes = this.blobs.get(ref.$ref);
    if (bytes === undefined) return undefined;
    return (async function* () {
      yield bytes;
    })();
  }
}

// ==========================================================================
// Mixed-mode: append + object ports, each with its own passthrough consumer.
// ==========================================================================

type MixedOut = { text: string; items: unknown[] };

const objDelta = (i: number): unknown[] => [{ id: i, pad: "x".repeat(32) }];

/** Per-port producer/consumer byte accounting, using streamEventCost's units. */
class PortMeter {
  produced = 0;
  consumed = 0;
  peakLead = 0;
  noteProduced(cost: number): void {
    this.produced += cost;
    this.peakLead = Math.max(this.peakLead, this.produced - this.consumed);
  }
  noteConsumed(cost: number): void {
    this.consumed += cost;
  }
}

/** Interleaves text deltas (fast port) with object deltas (slow port). */
class MixedSource extends Task<Record<string, never>, MixedOut> {
  public static override type = "StreamMixedMode_Source";
  public static override category = "Test";
  public static override cacheable = true;
  public textMeter: PortMeter | undefined;
  public objMeter: PortMeter | undefined;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
        items: { type: "array", "x-stream": "object" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<MixedOut>> {
    for (let i = 0; i < CHUNKS; i++) {
      yield { type: "text-delta", port: "text", textDelta: TEXT_CHUNK };
      this.textMeter?.noteProduced(TEXT_CHUNK.length);
      const delta = objDelta(i);
      yield { type: "object-delta", port: "items", objectDelta: delta };
      this.objMeter?.noteProduced(JSON.stringify(delta).length);
    }
    yield { type: "finish", data: {} as MixedOut };
  }
}

/** Fast append passthrough consumer for the `text` port. */
class FastTextConsumer extends Task<{ text: string }, { text: string }> {
  public static override type = "StreamMixedMode_TextConsumer";
  public static override category = "Test";
  public static override cacheable = false;
  public meter: PortMeter | undefined;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(
    _input: { text: string },
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<{ text: string }>> {
    const stream = ctx.inputStreams?.get("text");
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "text-delta") {
            this.meter?.noteConsumed(value.textDelta.length);
            yield { type: "text-delta", port: "text", textDelta: value.textDelta };
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    yield { type: "finish", data: {} as { text: string } };
  }
}

/** Slow object passthrough consumer for the `items` port. */
class SlowObjectConsumer extends Task<{ items: unknown[] }, { items: unknown[] }> {
  public static override type = "StreamMixedMode_ObjectConsumer";
  public static override category = "Test";
  public static override cacheable = false;
  public meter: PortMeter | undefined;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { items: { type: "array", "x-stream": "object" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { items: { type: "array", "x-stream": "object" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(
    _input: { items: unknown[] },
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<{ items: unknown[] }>> {
    const stream = ctx.inputStreams?.get("items");
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "object-delta") {
            await sleep(2);
            this.meter?.noteConsumed(JSON.stringify(value.objectDelta).length);
            yield { type: "object-delta", port: "items", objectDelta: value.objectDelta };
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    yield { type: "finish", data: {} as { items: unknown[] } };
  }
}

// ==========================================================================
// Fan-out: one append port feeding two same-mode consumers.
// ==========================================================================

/** Append passthrough reader that records every delta it sees, in order. */
class RecordingTextConsumer extends Task<{ text: string }, { text: string }> {
  public static override type = "StreamFanout_RecordingConsumer";
  public static override category = "Test";
  public static override cacheable = false;
  public received: string[] = [];

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(
    _input: { text: string },
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<{ text: string }>> {
    const stream = ctx.inputStreams?.get("text");
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "text-delta") {
            this.received.push(value.textDelta);
            yield { type: "text-delta", port: "text", textDelta: value.textDelta };
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    yield { type: "finish", data: {} as { text: string } };
  }
}

/** Append source emitting ordered, distinguishable chunks. */
class OrderedAppendSource extends Task<Record<string, never>, { text: string }> {
  public static override type = "StreamFanout_Source";
  public static override category = "Test";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<{ text: string }>> {
    for (let i = 0; i < CHUNKS; i++) {
      yield { type: "text-delta", port: "text", textDelta: `[${i}]` };
    }
    yield { type: "finish", data: {} as { text: string } };
  }
}

describe("no-accumulation mixed-mode and fan-out", () => {
  let cache: StreamPortMemoryRepo;
  beforeEach(() => {
    cache = new StreamPortMemoryRepo();
  });
  afterEach(async () => {
    await cache.clear();
  });

  it("mixed-mode: each port sinks and paces independently against its own consumer", async () => {
    const graph = new TaskGraph();
    const source = new MixedSource({ id: "source" });
    source.runConfig = { ...source.runConfig, referenceThresholdBytes: 0 };
    const textMeter = new PortMeter();
    const objMeter = new PortMeter();
    source.textMeter = textMeter;
    source.objMeter = objMeter;
    const textConsumer = new FastTextConsumer({ id: "textConsumer" });
    textConsumer.meter = textMeter;
    const objectConsumer = new SlowObjectConsumer({ id: "objectConsumer" });
    objectConsumer.meter = objMeter;
    graph.addTasks([source, textConsumer, objectConsumer]);
    const textEdge = new Dataflow("source", "text", "textConsumer", "text");
    const itemsEdge = new Dataflow("source", "items", "objectConsumer", "items");
    graph.addDataflow(textEdge);
    graph.addDataflow(itemsEdge);

    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph(
      {},
      { outputCache: cache, noAccumulation: true, streamHighWaterBytes: HIGH_WATER }
    );

    // Both ports were sunk per-port with their own codec mode.
    expect(cache.savePortCalls).toContainEqual({ port: "text", mode: "append" });
    expect(cache.savePortCalls).toContainEqual({ port: "items", mode: "object" });

    // Both edges skipped the drain and carry per-port refs.
    expect(isCacheRef(textEdge.value)).toBe(true);
    expect(isCacheRef(itemsEdge.value)).toBe(true);

    // The slow object consumer bounded the producer's lead on ITS port.
    const maxObjCost = JSON.stringify(objDelta(CHUNKS - 1)).length;
    expect(objMeter.peakLead).toBeLessThanOrEqual(HIGH_WATER + 3 * maxObjCost);
    // The fast text port was never the bottleneck: its lead stays within its
    // own small pipeline allowance, not the slow port's backlog.
    expect(textMeter.peakLead).toBeLessThanOrEqual(HIGH_WATER + 3 * TEXT_CHUNK.length);

    // Complete, correct outputs on both branches.
    const textResult = results.find((r) => r.id === "textConsumer");
    expect((textResult!.data as { text: string }).text).toBe(TEXT_CHUNK.repeat(CHUNKS));
    const objResult = results.find((r) => r.id === "objectConsumer");
    const items = (objResult!.data as { items: unknown[] }).items;
    expect(items).toHaveLength(CHUNKS);
    expect(items[0]).toEqual({ id: 0, pad: "x".repeat(32) });
    expect(items[CHUNKS - 1]).toEqual({ id: CHUNKS - 1, pad: "x".repeat(32) });
  }, 20_000);

  it("fan-out: two consumers of one port fall back to the drain and both receive every event in order", async () => {
    const graph = new TaskGraph();
    const source = new OrderedAppendSource({ id: "source" });
    const consumerA = new RecordingTextConsumer({ id: "consumerA" });
    const consumerB = new RecordingTextConsumer({ id: "consumerB" });
    graph.addTasks([source, consumerA, consumerB]);
    const edgeA = new Dataflow("source", "text", "consumerA", "text");
    const edgeB = new Dataflow("source", "text", "consumerB", "text");
    graph.addDataflow(edgeA);
    graph.addDataflow(edgeB);

    // A fanned-out source port is not a passthrough edge — pacing is
    // best-effort by design (the precise gate is single-consumer only).
    expect(StreamPump.isNoAccumulationPassthroughEdge(graph, edgeA, true)).toBe(false);
    expect(StreamPump.isNoAccumulationPassthroughEdge(graph, edgeB, true)).toBe(false);

    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph(
      {},
      { outputCache: cache, noAccumulation: true, streamHighWaterBytes: HIGH_WATER }
    );

    // Every consumer saw the identical, in-order delta sequence.
    const expected = Array.from({ length: CHUNKS }, (_, i) => `[${i}]`);
    expect(consumerA.received).toEqual(expected);
    expect(consumerB.received).toEqual(expected);

    for (const id of ["consumerA", "consumerB"]) {
      const result = results.find((r) => r.id === id);
      expect((result!.data as { text: string }).text).toBe(expected.join(""));
    }
  }, 20_000);
});
