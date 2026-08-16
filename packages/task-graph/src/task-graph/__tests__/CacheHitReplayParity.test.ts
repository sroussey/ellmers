/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cache-hit replay parity for non-binary refs. A no-accumulation streaming
 * source (threshold 0 ⇒ the per-port ref survives in the saved row) is run
 * twice against the same streaming-port cache with a same-mode streaming
 * consumer. The second run is a cache HIT: the source does not execute again,
 * yet `replayStreamRefs` decodes the cached bytes through the mode codec and
 * re-emits the delta events, so the consumer receives the same data and
 * produces an output identical to the fresh run — for both `append` and
 * `object` modes.
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
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskOutputRepository,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";

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
  override async getOutputStreamByRef(
    ref: CacheRef
  ): Promise<AsyncIterable<Uint8Array> | undefined> {
    const bytes = this.blobs.get(ref.$ref);
    if (bytes === undefined) return undefined;
    // Yield in two slices to exercise multi-chunk decode on replay.
    const mid = Math.floor(bytes.byteLength / 2);
    return (async function* () {
      if (mid > 0) yield bytes.subarray(0, mid);
      yield bytes.subarray(mid);
    })();
  }
}

let appendRuns = 0;
type AOut = { text: string };
class AppendSrc extends Task<Record<string, never>, AOut> {
  public static override type = "ReplayParity_AppendSrc";
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
  async *executeStream(): AsyncIterable<StreamEvent<AOut>> {
    appendRuns++;
    yield { type: "text-delta", port: "text", textDelta: "Hello " };
    yield { type: "text-delta", port: "text", textDelta: "world" };
    yield { type: "finish", data: {} as AOut };
  }
}

class AppendSink extends Task<{ text: string }, AOut> {
  public static override type = "ReplayParity_AppendSink";
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
    _i: { text: string },
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<AOut>> {
    const stream = ctx.inputStreams?.get("text");
    let acc = "";
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "text-delta") acc += value.textDelta;
        }
      } finally {
        reader.releaseLock();
      }
    }
    yield { type: "text-delta", port: "text", textDelta: acc };
    yield { type: "finish", data: {} as AOut };
  }
}

let objectRuns = 0;
type OOut = { items: Array<{ id: number; v: string }> };
class ObjectSrc extends Task<Record<string, never>, OOut> {
  public static override type = "ReplayParity_ObjectSrc";
  public static override cacheable = true;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { items: { type: "array", "x-stream": "object" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<OOut>> {
    objectRuns++;
    yield { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "a" }] };
    yield { type: "object-delta", port: "items", objectDelta: [{ id: 2, v: "b" }] };
    yield { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "A" }] };
    yield { type: "finish", data: {} as OOut };
  }
}

class ObjectSink extends Task<{ items: unknown[] }, { items: unknown[] }> {
  public static override type = "ReplayParity_ObjectSink";
  public static override cacheable = false;
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
    _i: { items: unknown[] },
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<{ items: unknown[] }>> {
    const stream = ctx.inputStreams?.get("items");
    const deltas: unknown[] = [];
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "object-delta") {
            for (const item of value.objectDelta as unknown[]) deltas.push(item);
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    yield { type: "object-delta", port: "items", objectDelta: deltas };
    yield { type: "finish", data: { items: deltas } };
  }
}

function appendGraph(): TaskGraph {
  const g = new TaskGraph();
  const src = new AppendSrc({ id: "src" });
  src.runConfig = { ...src.runConfig, referenceThresholdBytes: 0 };
  const sink = new AppendSink({ id: "sink" });
  g.addTasks([src, sink]);
  g.addDataflow(new Dataflow("src", "text", "sink", "text"));
  return g;
}
function objectGraph(): TaskGraph {
  const g = new TaskGraph();
  const src = new ObjectSrc({ id: "src" });
  src.runConfig = { ...src.runConfig, referenceThresholdBytes: 0 };
  const sink = new ObjectSink({ id: "sink" });
  g.addTasks([src, sink]);
  g.addDataflow(new Dataflow("src", "items", "sink", "items"));
  return g;
}

describe("cache-hit replay parity (non-binary refs)", () => {
  let cache: StreamPortMemoryRepo;
  beforeEach(() => {
    cache = new StreamPortMemoryRepo();
    appendRuns = 0;
    objectRuns = 0;
  });

  it("append: cache hit replays the same value without re-executing the source", async () => {
    const cfg = { outputCache: cache, noAccumulation: true } as const;
    const fresh = await new TaskGraphRunner(appendGraph()).runGraph({}, cfg);
    const hit = await new TaskGraphRunner(appendGraph()).runGraph({}, cfg);

    expect(appendRuns).toBe(1); // second run served from cache
    const freshText = (fresh.find((r) => r.id === "sink")!.data as AOut).text;
    const hitText = (hit.find((r) => r.id === "sink")!.data as AOut).text;
    expect(freshText).toBe("Hello world");
    expect(hitText).toBe(freshText);
  });

  it("object: cache hit replays the folded array without re-executing the source", async () => {
    const cfg = { outputCache: cache, noAccumulation: true } as const;
    const fresh = await new TaskGraphRunner(objectGraph()).runGraph({}, cfg);
    const hit = await new TaskGraphRunner(objectGraph()).runGraph({}, cfg);

    expect(objectRuns).toBe(1);
    const freshItems = (fresh.find((r) => r.id === "sink")!.data as OOut).items;
    const hitItems = (hit.find((r) => r.id === "sink")!.data as OOut).items;
    // The consumer re-emits the streamed deltas on its own object-mode output
    // port, so its StreamProcessor folds them by id (id 1's later "A" upserts
    // the earlier "a"). Parity is hit == fresh; both fold identically.
    expect(freshItems).toEqual([
      { id: 1, v: "A" },
      { id: 2, v: "b" },
    ]);
    expect(hitItems).toEqual(freshItems);
  });
});
