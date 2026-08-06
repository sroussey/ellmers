/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CachePolicy, IExecuteContext, StreamEvent } from "@workglow/task-graph";
import {
  CACHE_REGISTRY,
  Dataflow,
  DefaultCacheRegistry,
  FsFolderTaskOutputRepository,
  isCacheRef,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
} from "@workglow/task-graph";
import { Container, ServiceRegistry, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingMemoryRepo } from "../../binding/StreamingMemoryRepo";

type BinOut = { bytes: Blob | ArrayBuffer };
type SinkInput = { bytes: Blob | ArrayBuffer };
type SinkOutput = { text: string };

let producerExecutions = 0;

/** Cacheable binary producer: yields two delta chunks (5 bytes total). */
class ReplayProducer extends Task<Record<string, never>, BinOut> {
  public static override type = "CacheHitReplay_Producer";
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
  ): AsyncIterable<StreamEvent<BinOut>> {
    producerExecutions++;
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2, 3]) };
    await sleep(1);
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([4, 5]) };
    yield { type: "finish", data: {} as BinOut };
  }
}

/**
 * Streaming consumer: reads the binary input stream from
 * `this.runner.inputStreams` and records every delta it sees.
 */
class CollectingStreamConsumer extends Task<SinkInput, SinkOutput> {
  public static override type = "CacheHitReplay_StreamConsumer";
  public static override category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public deltaCount = 0;
  public collected: number[] = [];

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
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SinkInput,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<SinkOutput>> {
    const stream = this.runner.inputStreams?.get("bytes");
    if (stream) {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "binary-delta") {
          this.deltaCount++;
          for (const b of value.binaryDelta) this.collected.push(b);
        }
      }
    }
    yield { type: "finish", data: { text: `len:${this.collected.length}` } };
  }
}

/** Materializing consumer: plain blob input port, no `x-stream`. */
class MaterializingConsumer extends Task<SinkInput, SinkOutput> {
  public static override type = "CacheHitReplay_MaterializingConsumer";
  public static override category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public received: unknown;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { title: "Bytes" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: SinkInput): Promise<SinkOutput> {
    this.received = input.bytes;
    if (input.bytes instanceof Blob) return { text: `blob:${input.bytes.size}` };
    return { text: `other` };
  }
}

let repo: StreamingMemoryRepo;
let services: ServiceRegistry;

beforeEach(() => {
  producerExecutions = 0;
  repo = new StreamingMemoryRepo({});
  services = new ServiceRegistry(new Container());
  services.registerInstance(CACHE_REGISTRY, new DefaultCacheRegistry({ deterministic: repo }));
});

function buildStreamingGraph(): { graph: TaskGraph; consumer: CollectingStreamConsumer } {
  const graph = new TaskGraph();
  const producer = new ReplayProducer({ id: "producer" }, { referenceThresholdBytes: 0 });
  const consumer = new CollectingStreamConsumer({ id: "consumer" });
  graph.addTasks([producer, consumer]);
  graph.addDataflow(new Dataflow("producer", "bytes", "consumer", "bytes"));
  return { graph, consumer };
}

function buildMaterializingGraph(): { graph: TaskGraph; consumer: MaterializingConsumer } {
  const graph = new TaskGraph();
  const producer = new ReplayProducer({ id: "producer" }, { referenceThresholdBytes: 0 });
  const consumer = new MaterializingConsumer({ id: "consumer" });
  graph.addTasks([producer, consumer]);
  graph.addDataflow(new Dataflow("producer", "bytes", "consumer", "bytes"));
  return { graph, consumer };
}

describe("cache-hit replay of binary CacheRefs", () => {
  it("replays cached bytes as chunked binary-delta events to a streaming consumer", async () => {
    const first = buildStreamingGraph();
    await new TaskGraphRunner(first.graph).runGraph({}, { registry: services });
    expect(producerExecutions).toBe(1);
    expect(first.consumer.collected).toEqual([1, 2, 3, 4, 5]);

    // Replay reads back in 2-byte chunks → at least 2 deltas on the cache hit.
    repo.streamReadChunkSize = 2;
    const second = buildStreamingGraph();
    await new TaskGraphRunner(second.graph).runGraph({}, { registry: services });

    expect(producerExecutions).toBe(1); // cache hit — producer not re-executed
    expect(second.consumer.deltaCount).toBeGreaterThanOrEqual(2);
    expect(second.consumer.collected).toEqual([1, 2, 3, 4, 5]);
  });

  it("hydrates the ref into the enriched finish for a materializing consumer", async () => {
    const first = buildMaterializingGraph();
    await new TaskGraphRunner(first.graph).runGraph({}, { registry: services });
    expect(producerExecutions).toBe(1);
    expect(first.consumer.received).toBeInstanceOf(Blob);

    const second = buildMaterializingGraph();
    await new TaskGraphRunner(second.graph).runGraph({}, { registry: services });

    expect(producerExecutions).toBe(1); // cache hit
    expect(second.consumer.received).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await (second.consumer.received as Blob).arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("treats a dangling ref as a cache miss and re-executes (self-healing)", async () => {
    const first = buildMaterializingGraph();
    await new TaskGraphRunner(first.graph).runGraph({}, { registry: services });
    expect(producerExecutions).toBe(1);

    // Keep the JSON row (with its ref) but delete the bytes behind it.
    repo.streamed.clear();

    const second = buildMaterializingGraph();
    await new TaskGraphRunner(second.graph).runGraph({}, { registry: services });

    expect(producerExecutions).toBe(2); // re-executed, cache rewritten
    expect(second.consumer.received).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await (second.consumer.received as Blob).arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves the ref untouched and performs no reads when there are no consumers", async () => {
    const buildLeafGraph = () => {
      const graph = new TaskGraph();
      graph.addTask(new ReplayProducer({ id: "producer" }, { referenceThresholdBytes: 0 }));
      return graph;
    };
    await new TaskGraphRunner(buildLeafGraph()).runGraph({}, { registry: services });
    expect(producerExecutions).toBe(1);

    const streamSpy = vi.spyOn(repo, "getOutputStreamByRef");
    const blobSpy = vi.spyOn(repo, "getOutputByRef");
    const graph = buildLeafGraph();
    const results = await new TaskGraphRunner(graph).runGraph({}, { registry: services });

    expect(producerExecutions).toBe(1); // cache hit
    expect(streamSpy).not.toHaveBeenCalled();
    expect(blobSpy).not.toHaveBeenCalled();
    const producerResult = results.find((r) => r.id === "producer");
    expect(isCacheRef((producerResult!.data as Record<string, unknown>).bytes)).toBe(true);
    expect(graph.getTask("producer")!.status).toBe(TaskStatus.COMPLETED);
  });

  it("replays end-to-end through FsFolderTaskOutputRepository", async () => {
    const folder = await mkdtemp(join(tmpdir(), "wg-cache-replay-"));
    const fsRepo = new FsFolderTaskOutputRepository(folder);
    const fsServices = new ServiceRegistry(new Container());
    fsServices.registerInstance(
      CACHE_REGISTRY,
      new DefaultCacheRegistry({ deterministic: fsRepo })
    );

    const first = buildStreamingGraph();
    await new TaskGraphRunner(first.graph).runGraph({}, { registry: fsServices });
    expect(producerExecutions).toBe(1);
    expect(first.consumer.collected).toEqual([1, 2, 3, 4, 5]);

    const second = buildStreamingGraph();
    await new TaskGraphRunner(second.graph).runGraph({}, { registry: fsServices });

    expect(producerExecutions).toBe(1); // cache hit from disk
    expect(second.consumer.deltaCount).toBeGreaterThanOrEqual(1);
    expect(second.consumer.collected).toEqual([1, 2, 3, 4, 5]);
  });
});
