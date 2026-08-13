/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The passthrough-gate watchdog exists to catch a producer parked at the
 * high-water mark with a consumer that will never drain it. It must NOT trip
 * on an idle gate: a slow producer pausing between deltas (buffered cost
 * under the mark, consumer fully caught up and awaiting the next chunk) is a
 * healthy run, and the timer callback re-arms instead of failing it. A gate
 * that IS above the mark with no pull/credit progress still trips.
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
import { setLogger, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

setLogger(getTestingLogger());

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

/** Emits a few deltas with pauses LONGER than the watchdog window. */
class SlowIdleSource extends Task<Record<string, never>, TextOut> {
  public static override type = "WatchdogIdle_SlowSource";
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
    for (let i = 0; i < 3; i++) {
      yield { type: "text-delta", port: "text", textDelta: "0123456789" };
      await sleep(150);
    }
    yield { type: "finish", data: {} as TextOut };
  }
}

/** Emits enough bytes to park at a small high-water mark, quickly. */
class BurstSource extends Task<Record<string, never>, TextOut> {
  public static override type = "WatchdogIdle_BurstSource";
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
    for (let i = 0; i < 100; i++) {
      yield { type: "text-delta", port: "text", textDelta: "x".repeat(64) };
    }
    yield { type: "finish", data: {} as TextOut };
  }
}

class LiveConsumer extends Task<{ text: string }, TextOut> {
  public static override type = "WatchdogIdle_LiveConsumer";
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
    if (stream) {
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
    }
    yield { type: "finish", data: {} as TextOut };
  }
}

/**
 * Refuses to read its input stream for far longer than the watchdog window
 * (parking the producer at the gate with zero pull/credit progress), then
 * drains whatever is left so the run can settle instead of hanging on an
 * unfinished consumer.
 */
class SlowpokeConsumer extends Task<{ text: string }, TextOut> {
  public static override type = "WatchdogIdle_SlowpokeConsumer";
  public static override category = "Test";
  public static override cacheable = false;

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
    // Long enough that the 100 ms watchdog has fired several times over
    // while the producer sits parked above the mark.
    await sleep(600);
    const stream = ctx.inputStreams?.get("text");
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    }
    yield { type: "finish", data: {} as TextOut };
  }
}

describe("BackpressureGate.isAboveMark probe", () => {
  it("reflects buffered cost relative to the high-water mark", () => {
    const gate = new BackpressureGate(10);
    expect(gate.isAboveMark).toBe(false);
    gate.account(10);
    expect(gate.isAboveMark).toBe(true);
    gate.credit(1);
    expect(gate.isAboveMark).toBe(false);
  });
});

describe("passthrough gate watchdog", () => {
  it("does not trip on an idle gate: a slow producer with a live consumer completes", async () => {
    const cache = new StreamPortMemoryRepo();
    const graph = new TaskGraph();
    const source = new SlowIdleSource({ id: "source" });
    source.runConfig = { ...source.runConfig, referenceThresholdBytes: 0 };
    const consumer = new LiveConsumer({ id: "consumer" });
    graph.addTasks([source, consumer]);
    graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

    const runner = new TaskGraphRunner(graph);
    // Watchdog window (60 ms) is far shorter than the producer's idle gaps
    // (150 ms): pre-fix the timer failed the gate mid-gap; now it re-arms
    // because buffered cost is below the (default, large) high-water mark.
    const results = await runner.runGraph(
      {},
      { outputCache: cache, noAccumulation: true, streamGateWatchdogMs: 60 }
    );
    expect(results.length).toBeGreaterThan(0);
    expect(consumer.chunksRead).toBe(3);
  }, 15_000);

  it("still trips for a producer parked above the mark with a stalled consumer", async () => {
    const cache = new StreamPortMemoryRepo();
    const graph = new TaskGraph();
    const source = new BurstSource({ id: "source" });
    source.runConfig = { ...source.runConfig, referenceThresholdBytes: 0 };
    const consumer = new SlowpokeConsumer({ id: "consumer" });
    graph.addTasks([source, consumer]);
    graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

    const runner = new TaskGraphRunner(graph);
    await expect(
      runner.runGraph(
        {},
        {
          outputCache: cache,
          noAccumulation: true,
          streamHighWaterBytes: 16,
          streamGateWatchdogMs: 100,
        }
      )
    ).rejects.toThrow(/stalled/);
  }, 15_000);
});
