/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backpressure on the no-accumulation passthrough edge. A fast append-mode
 * producer feeds a deliberately slow same-mode consumer over a passthrough
 * edge with a small `streamHighWaterBytes`. The consumer-edge gate must park
 * the producer so its lead over the consumer (bytes emitted but not yet read)
 * stays within a small multiple of the high-water mark — instead of the
 * producer racing to completion and the whole stream buffering in memory.
 *
 * With `noAccumulation` off, the same graph takes the accumulation drain: the
 * producer runs free (no pacing) and the edge materializes the full string —
 * the pre-change behavior.
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
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskOutputRepository,
} from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CHUNK_BYTES = 64;
const CHUNKS = 40;
const TOTAL_BYTES = CHUNK_BYTES * CHUNKS;
const HIGH_WATER = 4 * CHUNK_BYTES;

// --------------------------------------------------------------------------
// Streaming-port in-memory cache (per-port byte streams keyed by task+inputs).
// The sink drains immediately, so the only thing that can pace the producer is
// the consumer-edge gate under test.
// --------------------------------------------------------------------------
class StreamPortMemoryRepo extends TaskOutputRepository {
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
  override async getOutputStreamByRef(
    ref: CacheRef
  ): Promise<AsyncIterable<Uint8Array> | undefined> {
    const bytes = this.blobs.get(ref.$ref);
    if (bytes === undefined) return undefined;
    return (async function* () {
      yield bytes;
    })();
  }
}

type Out = { text: string };

/** Shared per-run counters so the producer can observe the consumer's progress. */
class RunMeter {
  producedBytes = 0;
  consumedBytes = 0;
  peakLeadBytes = 0;
  noteProduced(bytes: number): void {
    this.producedBytes += bytes;
    this.peakLeadBytes = Math.max(this.peakLeadBytes, this.producedBytes - this.consumedBytes);
  }
  noteConsumed(bytes: number): void {
    this.consumedBytes += bytes;
  }
}

/**
 * Fast cacheable append-mode source: emits `CHUNKS` ASCII chunks of
 * `CHUNK_BYTES` each with no delay. Each yield resumes only after the
 * streaming runtime's per-event awaits, so `noteProduced` (called before the
 * next yield) reflects any pacing applied to the producer.
 */
class FastAppendSource extends Task<Record<string, never>, Out> {
  public static override type = "StreamBackpressureEngaged_Source";
  public static override category = "Test";
  public static override cacheable = true;
  public meter: RunMeter | undefined;

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
  async *executeStream(): AsyncIterable<StreamEvent<Out>> {
    for (let i = 0; i < CHUNKS; i++) {
      const chunk = String.fromCharCode(97 + (i % 26)).repeat(CHUNK_BYTES);
      yield { type: "text-delta", port: "text", textDelta: chunk };
      this.meter?.noteProduced(CHUNK_BYTES);
    }
    yield { type: "finish", data: {} as Out };
  }
}

/** Slow same-mode passthrough consumer: sleeps between reads of the live stream. */
class SlowAppendConsumer extends Task<{ text: string }, Out> {
  public static override type = "StreamBackpressureEngaged_Consumer";
  public static override category = "Test";
  public static override cacheable = false;
  public meter: RunMeter | undefined;

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
    input: { text: string },
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<Out>> {
    const stream = ctx.inputStreams?.get("text");
    if (!stream) {
      yield { type: "text-delta", port: "text", textDelta: input.text ?? "" };
      yield { type: "finish", data: {} as Out };
      return;
    }
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "text-delta") {
          await sleep(2);
          this.meter?.noteConsumed(value.textDelta.length);
          yield { type: "text-delta", port: "text", textDelta: value.textDelta };
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "finish", data: {} as Out };
  }
}

function buildGraph(meter: RunMeter): {
  graph: TaskGraph;
  edge: Dataflow;
  consumer: SlowAppendConsumer;
} {
  const graph = new TaskGraph();
  const source = new FastAppendSource({ id: "source" });
  source.meter = meter;
  // threshold 0 keeps the per-port ref in Output so the edge observably
  // carries a CacheRef rather than a rehydrated inline string.
  source.runConfig = { ...source.runConfig, referenceThresholdBytes: 0 };
  const consumer = new SlowAppendConsumer({ id: "consumer" });
  consumer.meter = meter;
  graph.addTasks([source, consumer]);
  const edge = new Dataflow("source", "text", "consumer", "text");
  graph.addDataflow(edge);
  return { graph, edge, consumer };
}

const expectedText = (): string => {
  let s = "";
  for (let i = 0; i < CHUNKS; i++) s += String.fromCharCode(97 + (i % 26)).repeat(CHUNK_BYTES);
  return s;
};

describe("no-accumulation passthrough backpressure", () => {
  let cache: StreamPortMemoryRepo;
  beforeEach(() => {
    cache = new StreamPortMemoryRepo();
  });
  afterEach(async () => {
    await cache.clear();
  });

  it("parks a fast producer to the slow consumer's read rate (peak lead bounded)", async () => {
    const meter = new RunMeter();
    const { graph, edge, consumer } = buildGraph(meter);
    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph(
      {},
      { outputCache: cache, noAccumulation: true, streamHighWaterBytes: HIGH_WATER }
    );

    // The producer's lead over the consumer stayed within the gate's bound:
    // the high-water mark plus a small pipeline allowance (the chunk that
    // crossed the mark, the edge wrapper's one-event prefetch, and the event
    // in flight between charge and the consumer's counter).
    expect(meter.peakLeadBytes).toBeLessThanOrEqual(HIGH_WATER + 3 * CHUNK_BYTES);
    // Sanity: the bound is meaningful — far below free-running distance.
    expect(TOTAL_BYTES).toBeGreaterThan(HIGH_WATER * 4);

    // Passthrough semantics held: the edge carries the per-port ref, and the
    // consumer's paced read still produced the complete output.
    expect(isCacheRef(edge.value)).toBe(true);
    const consumerResult = results.find((r) => r.id === "consumer");
    expect((consumerResult!.data as Out).text).toBe(expectedText());
    expect(meter.consumedBytes).toBe(TOTAL_BYTES);
    void consumer;
  }, 20_000);

  it("with noAccumulation off, the producer runs free and the edge materializes", async () => {
    const meter = new RunMeter();
    const { graph, edge } = buildGraph(meter);
    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph(
      {},
      { outputCache: cache, streamHighWaterBytes: HIGH_WATER }
    );

    // Off-path: no gate — the producer's lead is unbounded by the mark (it
    // races well past it while the slow consumer lags behind).
    expect(meter.peakLeadBytes).toBeGreaterThan(HIGH_WATER * 4);

    // Pre-change behavior: the edge drains to the materialized string.
    expect(edge.value).toBe(expectedText());
    const consumerResult = results.find((r) => r.id === "consumer");
    expect((consumerResult!.data as Out).text).toBe(expectedText());
  }, 20_000);
});
