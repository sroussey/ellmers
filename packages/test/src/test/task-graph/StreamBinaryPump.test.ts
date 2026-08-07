/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * StreamPump binary-stream behavior.
 *
 * C1 (regression guard): a binary source feeding a NON-binary consumer must
 * MATERIALIZE across the edge — `edgeNeedsAccumulation(binary → non-stream)` is
 * `true`, so the pump accumulates and the sink receives a finished `Blob`.
 *
 * C2 (cache-streaming decision): `StreamPump.canStreamBinaryToCache` is asserted
 * directly, in isolation from a live run: `true` for a streaming-capable cache +
 * binary-only leaf with no value-needing consumer; `false` for a buffered cache,
 * for a downstream edge that needs the materialized value, and (defensively) for
 * a cache that cannot report `supportsStreaming()`.
 *
 * The live byte delivery to `saveOutputStream` during a real run is owned by
 * `StreamProcessor`'s `BinaryStreamRouter` and covered by
 * `StreamProcessorBinaryRefSink.test.ts` / `TaskRunnerRefPath.test.ts`.
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
  makeCacheRef,
  StreamPump,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskOutputRepository,
  TaskStatus,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

setLogger(getTestingLogger());

// ============================================================================
// Test tasks
// ============================================================================

type BinOut = { bytes: Blob | ArrayBuffer };

/**
 * Binary streaming source: yields two `binary-delta` chunks then an empty
 * `finish` (mirrors a real producer that does not re-buffer its output).
 */
class BinaryStreamSource extends Task<Record<string, never>, BinOut> {
  public static override type = "StreamBinaryPump_Source";
  public static override category = "Test";
  public static override cacheable = false;

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
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<BinOut>> {
    if (context.signal.aborted) return;
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2]) };
    await sleep(2);
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([3, 4]) };
    yield { type: "finish", data: {} as BinOut };
  }

  override async execute(): Promise<BinOut> {
    return { bytes: new Blob([new Uint8Array([1, 2, 3, 4])]) };
  }
}

/**
 * A cacheable variant — needed to exercise the cache-streaming decision (the
 * cache is only consulted for cacheable tasks).
 */
class CacheableBinaryStreamSource extends BinaryStreamSource {
  public static override type = "StreamBinaryPump_CacheableSource";
  public static override cacheable = true;
}

type SinkInput = { bytes: Blob | ArrayBuffer };
type SinkOutput = { length: number; isBlob: boolean };

/**
 * Non-binary consumer: its `bytes` input port has NO `x-stream`, so a binary
 * source feeding it MUST materialize across the edge.
 */
class BinarySinkTask extends Task<SinkInput, SinkOutput> {
  public static override type = "StreamBinaryPump_Sink";
  public static override category = "Test";
  public static override cacheable = false;

  public received: Blob | ArrayBuffer | undefined = undefined;

  public static override inputSchema(): DataPortSchema {
    // No `type` constraint (accepts the materialized Blob at runtime) and NO
    // `x-stream` ⇒ a non-streaming consumer that needs the value across the edge.
    return {
      type: "object",
      properties: { bytes: { title: "Bytes", description: "materialized binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        length: { type: "number" },
        isBlob: { type: "boolean" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: SinkInput): Promise<SinkOutput> {
    this.received = input.bytes;
    if (input.bytes instanceof Blob) {
      return { length: input.bytes.size, isBlob: true };
    }
    if (input.bytes instanceof ArrayBuffer) {
      return { length: input.bytes.byteLength, isBlob: false };
    }
    return { length: -1, isBlob: false };
  }
}

// ============================================================================
// Cache repositories (in-test)
// ============================================================================

/**
 * Records whether `saveOutputStream` (streaming) vs `saveOutput` (buffered) was
 * invoked, and the total bytes seen through the streaming path.
 */
class StreamingMemoryRepo extends TaskOutputRepository {
  public saveOutputCalls = 0;
  public saveOutputStreamCalls = 0;
  public streamedBytes: number[] = [];
  private store = new Map<string, TaskOutput>();

  constructor() {
    super({ outputCompression: false });
  }

  override async saveOutput(
    taskType: string,
    inputs: TaskInput,
    output: TaskOutput
  ): Promise<void> {
    this.saveOutputCalls++;
    this.store.set(taskType + JSON.stringify(inputs), output);
  }

  override async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    return this.store.get(taskType + JSON.stringify(inputs));
  }

  override async clear(): Promise<void> {
    this.store.clear();
  }

  override async size(): Promise<number> {
    return this.store.size;
  }

  override async clearOlderThan(): Promise<void> {}

  override isDurable(): boolean {
    return false;
  }

  override async saveOutputStream(
    taskType: string,
    inputs: TaskInput,
    chunks: AsyncIterable<Uint8Array>,
    _metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    this.saveOutputStreamCalls++;
    let size = 0;
    for await (const c of chunks) {
      size += c.byteLength;
      for (const b of c) this.streamedBytes.push(b);
    }
    return makeCacheRef({ $ref: `inmem://${taskType}::${JSON.stringify(inputs)}`, size });
  }
}

/**
 * A buffered-only cache: extends the streaming repo but removes the streaming
 * capability so `supportsStreaming()` returns `false`.
 */
class BufferedMemoryRepo extends StreamingMemoryRepo {
  public override saveOutputStream =
    undefined as unknown as StreamingMemoryRepo["saveOutputStream"];
}

// ============================================================================
// Helpers
// ============================================================================

function blobFromFinish(event: StreamEvent | undefined): Blob | ArrayBuffer | undefined {
  if (!event || event.type !== "finish") return undefined;
  return (event.data as Record<string, unknown>)?.bytes as Blob | ArrayBuffer | undefined;
}

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

// ============================================================================
// C1: regression guard — binary source materializes across a non-binary edge
// ============================================================================

describe("StreamBinaryPump — C1 binary source → non-binary consumer", () => {
  it("materializes a Blob across the edge (no production change)", async () => {
    const graph = new TaskGraph();
    const source = new BinaryStreamSource({ id: "source" });
    const sink = new BinarySinkTask({ id: "sink" });

    graph.addTasks([source, sink]);
    graph.addDataflow(new Dataflow("source", "bytes", "sink", "bytes"));

    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph({});

    expect(source.status).toBe(TaskStatus.COMPLETED);
    expect(sink.status).toBe(TaskStatus.COMPLETED);

    // The sink received a materialized Blob with the concatenated bytes.
    expect(sink.received).toBeInstanceOf(Blob);
    const buf = await (sink.received as Blob).arrayBuffer();
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3, 4]);

    const sinkResult = results.find((r) => r.id === "sink");
    expect(sinkResult).toBeDefined();
    expect((sinkResult!.data as SinkOutput).isBlob).toBe(true);
    expect((sinkResult!.data as SinkOutput).length).toBe(4);
  });
});

// ============================================================================
// C2: cache-streaming decision — asserted DIRECTLY via canStreamBinaryToCache
//
// These tests assert the DECISION in isolation, not a real-run outcome. We
// deliberately do NOT run a streaming-cache graph and assert "binary port absent
// from finish" as correct: with no live sink driving saveOutputStream on a real
// run, absent bytes there means SILENT DATA LOSS, not success. The live pipe
// (cache actually receiving the bytes on a real run) is covered by the
// per-port sink and cache stream-out suites.
// ============================================================================

describe("StreamBinaryPump.canStreamBinaryToCache — decision", () => {
  it("returns true: streaming cache + binary-only leaf + no value-needing consumer", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    graph.addTask(source);

    expect(StreamPump.canStreamBinaryToCache(graph, source, new StreamingMemoryRepo())).toBe(true);
  });

  it("returns false: buffered (non-streaming) cache", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    graph.addTask(source);

    const cache = new BufferedMemoryRepo();
    expect(cache.supportsStreaming()).toBe(false);
    expect(StreamPump.canStreamBinaryToCache(graph, source, cache)).toBe(false);
  });

  it("returns false: a downstream edge needs the materialized value", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    const sink = new BinarySinkTask({ id: "sink" });
    graph.addTasks([source, sink]);
    graph.addDataflow(new Dataflow("source", "bytes", "sink", "bytes"));

    // Streaming-capable cache present, but the non-binary consumer needs the
    // value across the edge ⇒ must still accumulate.
    expect(StreamPump.canStreamBinaryToCache(graph, source, new StreamingMemoryRepo())).toBe(false);
  });

  it("returns false (defensive): a cache that cannot report supportsStreaming()", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    graph.addTask(source);

    // A `{}`-style partial double with no `supportsStreaming` method: the guard
    // must treat anything that can't affirmatively report streaming support as
    // non-streaming, never optimistically piping.
    const partialCache = {} as unknown as TaskOutputRepository;
    expect(StreamPump.canStreamBinaryToCache(graph, source, partialCache)).toBe(false);
  });
});

// ============================================================================
// Stream-out decision: anyConsumerAcceptsStream (binary schemas)
// ============================================================================

/** Streaming consumer: its `bytes` input port accepts the binary stream mode. */
class BinaryStreamConsumer extends Task<SinkInput, SinkOutput> {
  public static override type = "StreamBinaryPump_StreamConsumer";
  public static override category = "Test";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "blob", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { length: { type: "number" }, isBlob: { type: "boolean" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: SinkInput): Promise<SinkOutput> {
    const size = input.bytes instanceof Blob ? input.bytes.size : (input.bytes?.byteLength ?? -1);
    return { length: size, isBlob: input.bytes instanceof Blob };
  }
}

describe("StreamPump.anyConsumerAcceptsStream (binary)", () => {
  it("returns true when an out-edge targets a binary-streaming input port", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    const consumer = new BinaryStreamConsumer({ id: "consumer" });
    graph.addTasks([source, consumer]);
    graph.addDataflow(new Dataflow("source", "bytes", "consumer", "bytes"));

    expect(StreamPump.anyConsumerAcceptsStream(graph, source)).toBe(true);
  });

  it("returns false with no consumers", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    graph.addTask(source);

    expect(StreamPump.anyConsumerAcceptsStream(graph, source)).toBe(false);
  });

  it("returns false when the only consumer needs a materialized value", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    const sink = new BinarySinkTask({ id: "sink" });
    graph.addTasks([source, sink]);
    graph.addDataflow(new Dataflow("source", "bytes", "sink", "bytes"));

    expect(StreamPump.anyConsumerAcceptsStream(graph, source)).toBe(false);
  });

  it("returns false for * fan-out edges (consumers receive materialized values)", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    const consumer = new BinaryStreamConsumer({ id: "consumer" });
    graph.addTasks([source, consumer]);
    graph.addDataflow(new Dataflow("source", "*", "consumer", "*"));

    expect(StreamPump.anyConsumerAcceptsStream(graph, source)).toBe(false);
  });

  it("returns true with mixed consumers (one streams, one materializes)", () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    const consumer = new BinaryStreamConsumer({ id: "consumer" });
    const sink = new BinarySinkTask({ id: "sink" });
    graph.addTasks([source, consumer, sink]);
    graph.addDataflow(new Dataflow("source", "bytes", "consumer", "bytes"));
    graph.addDataflow(new Dataflow("source", "bytes", "sink", "bytes"));

    expect(StreamPump.anyConsumerAcceptsStream(graph, source)).toBe(true);
  });
});

// ============================================================================
// C2: cache-streaming decision — observed on a real run via the source's finish.
//
// These run a real graph and assert the bytes ARE materialized (present) when the
// decision is "accumulate". They guard the POSITIVE outcome (bytes delivered), not
// the absence of bytes, so they do not bless data loss.
// ============================================================================

describe("StreamBinaryPump — C2 accumulation materializes bytes on a real run", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  it("DOES accumulate a leaf binary task when the cache cannot stream", async () => {
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    graph.addTask(source);
    const runner = new TaskGraphRunner(graph);

    const finishes: StreamEvent[] = [];
    source.on("stream_chunk", (e) => {
      if (e.type === "finish") finishes.push(e);
    });

    const cache = new BufferedMemoryRepo();
    expect(cache.supportsStreaming()).toBe(false);
    await runner.runGraph({}, { outputCache: cache });

    // Decision = true ⇒ enriched finish ⇒ binary port materialized to a Blob.
    expect(finishes.length).toBe(1);
    const bytes = blobFromFinish(finishes[0]);
    expect(bytes).toBeInstanceOf(Blob);
    const buf = await (bytes as Blob).arrayBuffer();
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3, 4]);
  });

  it("tees when a downstream edge needs materialized AND the cache can stream", async () => {
    // cache-can-stream + downstream-needs-materialized used to inhibit refs
    // entirely. Now both paths fire — accumulator drives the
    // enriched finish event (Blob for the edge consumer) and the router
    // writes to the cache so the queue/cache row stays small.
    const graph = new TaskGraph();
    const source = new CacheableBinaryStreamSource({ id: "source" });
    const sink = new BinarySinkTask({ id: "sink" });
    graph.addTasks([source, sink]);
    graph.addDataflow(new Dataflow("source", "bytes", "sink", "bytes"));
    const runner = new TaskGraphRunner(graph);

    const finishes: StreamEvent[] = [];
    source.on("stream_chunk", (e) => {
      if (e.type === "finish") finishes.push(e);
    });

    const cache = new StreamingMemoryRepo();
    await runner.runGraph({}, { outputCache: cache });

    // Edge path: downstream still receives a materialized Blob.
    expect(finishes.length).toBe(1);
    const bytes = blobFromFinish(finishes[0]);
    expect(bytes).toBeInstanceOf(Blob);
    expect(sink.received).toBeInstanceOf(Blob);

    // Cache path: the streaming sink fired too (tee).
    expect(cache.saveOutputStreamCalls).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Sanity: the in-test repos behave as expected
// ============================================================================

describe("StreamBinaryPump — repo capability sanity", () => {
  let repo: StreamingMemoryRepo;
  beforeEach(() => {
    repo = new StreamingMemoryRepo();
  });

  it("streaming repo reports supportsStreaming() === true", () => {
    expect(repo.supportsStreaming()).toBe(true);
  });

  it("buffered repo reports supportsStreaming() === false", () => {
    expect(new BufferedMemoryRepo().supportsStreaming()).toBe(false);
  });

  it("saveOutputStream concatenates all delivered bytes", async () => {
    await repo.saveOutputStream(
      "T",
      { k: 1 },
      gen(new Uint8Array([1, 2]), new Uint8Array([3])),
      {}
    );
    expect(repo.streamedBytes).toEqual([1, 2, 3]);
  });
});
