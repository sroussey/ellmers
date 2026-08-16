/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end no-accumulation passthrough (append mode). A cacheable streaming
 * source feeds a single same-mode streaming consumer over a plain edge with a
 * streaming-port cache and `noAccumulation: true`. The source pipes its `text`
 * deltas straight to the per-port cache sink (no enriched-finish buffer), the
 * source→consumer edge is NOT drained — it carries the per-port `CacheRef`
 * instead of a materialized string — and the consumer reads the live stream and
 * still produces the correct, complete output.
 *
 * With `noAccumulation` off, the same graph keeps today's behavior: the edge
 * materializes the accumulated string.
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
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// --------------------------------------------------------------------------
// A streaming-port in-memory cache: stores each (taskType, inputs, port) byte
// stream and serves it back through getOutputStreamByRef / getOutputByRef.
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
    return bytes === undefined ? undefined : new Blob([bytes as unknown as BlobPart]);
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

/** Cacheable append-mode source. */
class AppendSource extends Task<Record<string, never>, Out> {
  public static override type = "NoAccumPassthrough_Source";
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
  async *executeStream(): AsyncIterable<StreamEvent<Out>> {
    yield { type: "text-delta", port: "text", textDelta: "Hello " };
    yield { type: "text-delta", port: "text", textDelta: "stream" };
    yield { type: "finish", data: {} as Out };
  }
}

/** Same-mode append passthrough consumer: reads the live input stream. */
class AppendPassthrough extends Task<{ text: string }, Out> {
  public static override type = "NoAccumPassthrough_Consumer";
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
          yield { type: "text-delta", port: "text", textDelta: value.textDelta };
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "finish", data: {} as Out };
  }
}

function buildGraph(): { graph: TaskGraph; edge: Dataflow } {
  const graph = new TaskGraph();
  const source = new AppendSource({ id: "source" });
  // threshold 0 so the per-port ref SURVIVES (not rehydrated inline) — lets us
  // observe the edge carrying a ref rather than a materialized string.
  source.runConfig = { ...source.runConfig, referenceThresholdBytes: 0 };
  const consumer = new AppendPassthrough({ id: "consumer" });
  graph.addTasks([source, consumer]);
  const edge = new Dataflow("source", "text", "consumer", "text");
  graph.addDataflow(edge);
  return { graph, edge };
}

describe("no-accumulation passthrough (append, end-to-end)", () => {
  let cache: StreamPortMemoryRepo;
  beforeEach(() => {
    cache = new StreamPortMemoryRepo();
  });
  afterEach(async () => {
    await cache.clear();
  });

  it("skips the drain: edge carries a CacheRef and the consumer output is complete", async () => {
    const { graph, edge } = buildGraph();
    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph({}, { outputCache: cache, noAccumulation: true });

    // The per-port sink ran for the source's text port (append mode).
    expect(cache.savePortCalls).toContainEqual({ port: "text", mode: "append" });

    // The source→consumer edge was NOT drained to a string — it holds the ref.
    expect(isCacheRef(edge.value)).toBe(true);
    expect(typeof edge.value).not.toBe("string");

    // The consumer still received the full stream and produced the complete text.
    const consumerResult = results.find((r) => r.id === "consumer");
    expect((consumerResult!.data as Out).text).toBe("Hello stream");
  });

  it("with noAccumulation off, the edge materializes the accumulated string", async () => {
    const { graph, edge } = buildGraph();
    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph({}, { outputCache: cache });

    // Today's behavior: the edge drains to the materialized string.
    expect(edge.value).toBe("Hello stream");
    const consumerResult = results.find((r) => r.id === "consumer");
    expect((consumerResult!.data as Out).text).toBe("Hello stream");
  });
});
