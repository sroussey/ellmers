/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression: silent output loss for a CACHEABLE passthrough consumer under
 * `noAccumulation: true`.
 *
 * The graph opts the consumer out of accumulation because its streamable
 * ports look sinkable (`canStreamAllPortsToCache`), but the consumer's run
 * consumes a live stream at an unsettled input port, so TaskRunner downgrades
 * its cache policy to `none` — and with that, no per-port sink is ever built.
 * With neither an accumulator nor a sink, the consumer's re-yielded deltas
 * used to vanish and its output came back empty. The runner must force
 * accumulation when a streamable task with delta-mode ports ends up with no
 * sink map, so the streamed output survives.
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
  TaskStatus,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  public static override type = "NoAccumCacheableConsumer_Source";
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

/**
 * Same-mode append passthrough consumer, but CACHEABLE — the graph plans
 * per-port sinks for it, while the live stream-wired input downgrades its
 * policy to `none` at run time (no sink is actually built).
 */
class CacheableAppendPassthrough extends Task<{ text: string }, Out> {
  public static override type = "NoAccumCacheableConsumer_Consumer";
  public static override category = "Test";
  public static override cacheable = true;

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

describe("no-accumulation passthrough with a cacheable consumer", () => {
  let cache: StreamPortMemoryRepo;
  beforeEach(() => {
    cache = new StreamPortMemoryRepo();
  });
  afterEach(async () => {
    await cache.clear();
  });

  it("the consumer's streamed output survives (forced accumulation when no sink resolves)", async () => {
    const graph = new TaskGraph();
    const source = new AppendSource({ id: "source" });
    // threshold 0 so the source's per-port ref SURVIVES — keeps the edge on
    // the ref-carrying passthrough path rather than an inline rehydration.
    source.runConfig = { ...source.runConfig, referenceThresholdBytes: 0 };
    const consumer = new CacheableAppendPassthrough({ id: "consumer" });
    graph.addTasks([source, consumer]);
    const edge = new Dataflow("source", "text", "consumer", "text");
    graph.addDataflow(edge);

    const runner = new TaskGraphRunner(graph);
    const results = await runner.runGraph({}, { outputCache: cache, noAccumulation: true });

    // The passthrough itself still applied: the source sank its port and the
    // edge carries the ref (not a drained string).
    expect(cache.savePortCalls).toContainEqual({ port: "text", mode: "append" });
    expect(isCacheRef(edge.value)).toBe(true);

    // The consumer's streamed output was NOT silently dropped.
    expect(consumer.status).toBe(TaskStatus.COMPLETED);
    const consumerResult = results.find((r) => r.id === "consumer");
    expect((consumerResult!.data as Out).text).toBe("Hello stream");
    expect((consumer.runOutputData as Out).text).toBe("Hello stream");
  });
});
