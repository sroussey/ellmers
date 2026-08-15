/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A cached row can carry one {@link CacheRef} per streamed output port, so a
 * PARTIALLY resolvable entry is representable: port A's blob survives while
 * port B's was evicted. This pins the all-or-nothing invariant — one dangling
 * ref among N converts the whole lookup into a miss, the task re-executes, and
 * every port comes back with its full value. A half-resolved output (a value at
 * one port, `undefined` at another the row claims has bytes) must never reach a
 * consumer: recomputing is cheaper than a silent hole.
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

/**
 * Streaming repo whose per-port blobs are individually evictable, so a test can
 * drop exactly one port's bytes and leave the row (with both refs) intact.
 */
class PerPortMemoryRepo extends TaskOutputRepository {
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
    return (async function* () {
      yield bytes;
    })();
  }

  /** Evict every blob written for `port`, leaving the rows (and refs) alone. */
  evictPort(port: string): number {
    let dropped = 0;
    for (const key of [...this.blobs.keys()]) {
      if (key.endsWith(`::${port}`)) {
        this.blobs.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  /** How many port blobs are currently stored. */
  blobCount(): number {
    return this.blobs.size;
  }
}

let srcRuns = 0;
type TwoPortOut = { text: string; items: Array<{ id: number; v: string }> };

/** Cacheable source streaming two ports of different delta modes. */
class TwoPortSrc extends Task<Record<string, never>, TwoPortOut> {
  public static override type = "PartialRefMiss_TwoPortSrc";
  public static override category = "Test";
  public static override cacheable = true;
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
  async *executeStream(): AsyncIterable<StreamEvent<TwoPortOut>> {
    srcRuns++;
    yield { type: "text-delta", port: "text", textDelta: "Hello " };
    yield { type: "text-delta", port: "text", textDelta: "world" };
    yield { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "a" }] };
    yield { type: "object-delta", port: "items", objectDelta: [{ id: 2, v: "b" }] };
    yield { type: "finish", data: {} as TwoPortOut };
  }
}

class AppendSink extends Task<{ text: string }, { text: string }> {
  public static override type = "PartialRefMiss_AppendSink";
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
    _i: { text: string },
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<{ text: string }>> {
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
    yield { type: "finish", data: {} as { text: string } };
  }
}

class ObjectSink extends Task<{ items: unknown[] }, { items: unknown[] }> {
  public static override type = "PartialRefMiss_ObjectSink";
  public static override category = "Test";
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

function twoPortGraph(): TaskGraph {
  const g = new TaskGraph();
  const src = new TwoPortSrc({ id: "src" });
  src.runConfig = { ...src.runConfig, referenceThresholdBytes: 0 };
  g.addTasks([src, new AppendSink({ id: "textSink" }), new ObjectSink({ id: "itemsSink" })]);
  g.addDataflow(new Dataflow("src", "text", "textSink", "text"));
  g.addDataflow(new Dataflow("src", "items", "itemsSink", "items"));
  return g;
}

const EXPECTED_TEXT = "Hello world";
const EXPECTED_ITEMS = [
  { id: 1, v: "a" },
  { id: 2, v: "b" },
];

function sinkValues(results: Array<{ id: unknown; data: unknown }>): {
  text: unknown;
  items: unknown;
} {
  const text = (results.find((r) => r.id === "textSink")!.data as { text: unknown }).text;
  const items = (results.find((r) => r.id === "itemsSink")!.data as { items: unknown }).items;
  return { text, items };
}

describe("partial multi-port ref resolution", () => {
  let cache: PerPortMemoryRepo;
  const cfg = () => ({ outputCache: cache, noAccumulation: true }) as const;

  beforeEach(() => {
    cache = new PerPortMemoryRepo();
    srcRuns = 0;
  });

  it("writes one ref per streamed port and replays both on a full hit", async () => {
    const fresh = await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());
    expect(srcRuns).toBe(1);
    expect(cache.blobCount()).toBe(2);
    expect(sinkValues(fresh)).toEqual({ text: EXPECTED_TEXT, items: EXPECTED_ITEMS });

    const hit = await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());
    expect(srcRuns).toBe(1); // served entirely from cache
    expect(sinkValues(hit)).toEqual({ text: EXPECTED_TEXT, items: EXPECTED_ITEMS });
  });

  it("treats one evicted port of two as a whole-entry miss, not a half-resolved output", async () => {
    await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());
    expect(srcRuns).toBe(1);

    // Row keeps BOTH refs; only the `items` bytes go away.
    expect(cache.evictPort("items")).toBe(1);

    const results = await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());

    expect(srcRuns).toBe(2); // recomputed rather than replaying a hole
    const { text, items } = sinkValues(results);
    expect(items).toEqual(EXPECTED_ITEMS);
    expect(items).not.toBeUndefined();
    // The surviving port is NOT served from its stale ref alongside a hole at
    // the evicted one — the whole entry was recomputed.
    expect(text).toBe(EXPECTED_TEXT);
  });

  it("misses the same way when the surviving port is the object one", async () => {
    await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());
    expect(srcRuns).toBe(1);

    expect(cache.evictPort("text")).toBe(1);

    const results = await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());

    expect(srcRuns).toBe(2);
    expect(sinkValues(results)).toEqual({ text: EXPECTED_TEXT, items: EXPECTED_ITEMS });
  });

  it("re-executing rewrites both ports so the next run hits again (self-heal)", async () => {
    await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());
    cache.evictPort("items");
    await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());
    expect(srcRuns).toBe(2);

    const healed = await new TaskGraphRunner(twoPortGraph()).runGraph({}, cfg());
    expect(srcRuns).toBe(2); // hit again — the rewrite restored both blobs
    expect(sinkValues(healed)).toEqual({ text: EXPECTED_TEXT, items: EXPECTED_ITEMS });
  });
});
