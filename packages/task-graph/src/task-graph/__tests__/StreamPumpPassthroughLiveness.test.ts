/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Liveness guards on the no-accumulation passthrough gate.
 *
 * A producer parked at the high-water mark must NOT stay parked forever if the
 * consumer stops making progress — an aborted run or a wedged consumer both
 * have to release the producer. The passthrough gate closes immediately on
 * ctx.abortController.abort() and fails when neither pull nor credit
 * progresses within `streamGateWatchdogMs`. A live consumer keeps rearming the
 * watchdog on each read, so real workloads never see it trip.
 *
 * These tests drive the primitive (`BackpressureGate`) plus the end-to-end
 * behavior of a live-consumer graph (which must complete under a strict
 * watchdog) and the ungated regression path.
 */

import type {
  CacheRef,
  IExecuteContext,
  StreamEvent,
  TaskInput,
  TaskOutput,
} from "@workglow/task-graph";
import {
  BackpressureGate,
  Dataflow,
  makeCacheRef,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskOutputRepository,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    return bytes === undefined ? undefined : new Blob([bytes as unknown as BlobPart]);
  }
  override getOutputStreamByRef(ref: CacheRef): AsyncIterable<Uint8Array> | undefined {
    const bytes = this.blobs.get(ref.$ref);
    if (bytes === undefined) return undefined;
    return (async function* () {
      yield bytes;
    })();
  }
}

type TextOut = { text: string };

class ChunkySource extends Task<Record<string, never>, TextOut> {
  public static override type = "PassthroughLiveness_Source";
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
  async *executeStream(): AsyncIterable<StreamEvent<TextOut>> {
    for (let i = 0; i < 50; i++) {
      yield { type: "text-delta", port: "text", textDelta: "0123456789" };
    }
    yield { type: "finish", data: {} as TextOut };
  }
}

class LiveConsumer extends Task<{ text: string }, TextOut> {
  public static override type = "PassthroughLiveness_LiveConsumer";
  public static override category = "Test";
  public static override cacheable = false;
  public chunksRead = 0;

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
  ): AsyncIterable<StreamEvent<TextOut>> {
    const stream = ctx.inputStreams?.get("text");
    if (!stream) {
      yield { type: "finish", data: {} as TextOut };
      return;
    }
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "text-delta") this.chunksRead += 1;
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "finish", data: {} as TextOut };
  }
}

function buildGraph(): { graph: TaskGraph; consumer: LiveConsumer } {
  const graph = new TaskGraph();
  const source = new ChunkySource({ id: "source" });
  source.runConfig = { ...source.runConfig, referenceThresholdBytes: 0 };
  const consumer = new LiveConsumer({ id: "consumer" });
  graph.addTasks([source, consumer]);
  graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));
  return { graph, consumer };
}

describe("BackpressureGate liveness primitives", () => {
  it("close() resolves a parked producer without an error", async () => {
    const gate = new BackpressureGate(1);
    const parked = gate.charge(10); // buffered=10 > HWM=1 → parks
    gate.close();
    await expect(parked).resolves.toBeUndefined();
  });

  it("fail(err) rejects a parked producer with the supplied error", async () => {
    const gate = new BackpressureGate(1);
    const parked = gate.charge(10);
    const bomb = new Error("watchdog tripped");
    gate.fail(bomb);
    await expect(parked).rejects.toBe(bomb);
  });

  it("credit() below the mark resolves the parked producer normally (no error)", async () => {
    const gate = new BackpressureGate(1);
    const parked = gate.charge(10);
    gate.credit(10);
    await expect(parked).resolves.toBeUndefined();
    expect(gate.closed).toBe(false);
  });

  it("charge() after fail() rejects immediately", async () => {
    const gate = new BackpressureGate(1);
    const bomb = new Error("dead consumer");
    gate.fail(bomb);
    await expect(gate.charge(10)).rejects.toBe(bomb);
  });

  it("awaitBelowMark() after fail() rejects immediately", async () => {
    const gate = new BackpressureGate(1);
    gate.charge(10).catch(() => {});
    const bomb = new Error("dead consumer");
    gate.fail(bomb);
    await expect(gate.awaitBelowMark()).rejects.toBe(bomb);
  });
});

describe("StreamPump passthrough edge gate liveness (end-to-end)", () => {
  let cache: StreamPortMemoryRepo;
  beforeEach(() => {
    cache = new StreamPortMemoryRepo();
  });
  afterEach(async () => {
    await cache.clear();
  });

  it("a live consumer keeps rearming the watchdog and the run completes", async () => {
    const { graph, consumer } = buildGraph();
    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph(
      {},
      {
        outputCache: cache,
        noAccumulation: true,
        streamHighWaterBytes: 1,
        streamGateWatchdogMs: 5000,
      }
    );
    expect(results.length).toBeGreaterThan(0);
    expect(consumer.chunksRead).toBeGreaterThan(0);
  });

  it("streamGateWatchdogMs=0 disables the watchdog (live consumer still completes)", async () => {
    const { graph } = buildGraph();
    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph(
      {},
      {
        outputCache: cache,
        noAccumulation: true,
        streamHighWaterBytes: 1,
        streamGateWatchdogMs: 0,
      }
    );
    expect(results.length).toBeGreaterThan(0);
  });

  it("noAccumulation off keeps the pre-liveness accumulation behavior (regression)", async () => {
    const { graph } = buildGraph();
    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph({}, { outputCache: cache });
    expect(results.length).toBeGreaterThan(0);
  });
});
