/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";
import {
  CacheCoordinator,
  StreamProcessor,
  Task,
  TaskRegistry,
  TaskRunContext,
  type CachePolicy,
} from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

// ============================================================================
// TaskRunContext
// ============================================================================

describe("TaskRunContext", () => {
  it("dispose() removes the parentSignal listener", () => {
    const parent = new AbortController();
    const ctx = new TaskRunContext(parent.signal);

    ctx.dispose();
    parent.abort();

    // ctx's own controller was not touched by parent.abort() because dispose()
    // removed the bridging listener
    expect(ctx.abortController.signal.aborted).toBe(false);
  });

  it("constructor: parent already aborted -> ctx aborts immediately, no listener leak", () => {
    const parent = new AbortController();
    parent.abort();

    const ctx = new TaskRunContext(parent.signal);
    expect(ctx.abortController.signal.aborted).toBe(true);

    // dispose should be a safe no-op since the cleanup ran inline
    ctx.dispose();
    ctx.dispose();
  });
});

// ============================================================================
// StreamProcessor (text-delta accumulation + replace-mode fallback)
// ============================================================================

type AccumInput = { text: string };
type AccumOutput = { text: string };

class AccumStreamingTask extends Task<AccumInput, AccumOutput> {
  public static override readonly type = "TestAccumStreaming";
  public static override readonly category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override readonly title = "Accum";
  public static override readonly description = "Accum";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
    } as const satisfies DataPortSchema;
  }
  public override async execute(input: AccumInput): Promise<AccumOutput> {
    return { text: input.text };
  }
  public async *executeStream(_input: AccumInput): AsyncIterable<StreamEvent<AccumOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Hello, " };
    yield { type: "text-delta", port: "text", textDelta: "world!" };
    yield { type: "finish", data: {} as AccumOutput };
  }
}

type ReplaceInput = { q: string };
type ReplaceOutput = { result: string };

class ReplaceStreamingTask extends Task<ReplaceInput, ReplaceOutput> {
  public static override readonly type = "TestReplaceStreaming";
  public static override readonly category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override readonly title = "Replace";
  public static override readonly description = "Replace";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { q: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "string", "x-stream": "replace" } },
    } as const satisfies DataPortSchema;
  }
  public override async execute(input: ReplaceInput): Promise<ReplaceOutput> {
    return { result: input.q };
  }
  public async *executeStream(_input: ReplaceInput): AsyncIterable<StreamEvent<ReplaceOutput>> {
    yield { type: "snapshot", data: { result: "intermediate" } };
    yield { type: "snapshot", data: { result: "final" } };
    // empty finish - exercise the replace-mode fallback
    yield { type: "finish", data: {} as ReplaceOutput };
  }
}

describe("StreamProcessor", () => {
  it("text-delta accumulation builds enriched finish payload", async () => {
    TaskRegistry.registerTask(AccumStreamingTask);
    const task = new AccumStreamingTask();
    const sp = new StreamProcessor<AccumInput, AccumOutput>(task);
    const ctx = new TaskRunContext();

    let finishData: Record<string, unknown> | undefined;
    task.subscribe("stream_chunk", (event: any) => {
      if (event.type === "finish") {
        finishData = event.data;
      }
    });

    await sp.run({ text: "ignored" }, ctx, {
      registry: globalServiceRegistry,
      resourceScope: undefined,
      inputStreams: undefined,
      onProgress: async () => {},
      own: (i) => i,
      disown: () => {},
    });

    expect(finishData).toEqual({ text: "Hello, world!" });
  });

  it("replace-mode finish with empty data falls back to last snapshot", async () => {
    TaskRegistry.registerTask(ReplaceStreamingTask);
    const task = new ReplaceStreamingTask();
    const sp = new StreamProcessor<ReplaceInput, ReplaceOutput>(task);
    const ctx = new TaskRunContext();

    const result = await sp.run({ q: "ignored" }, ctx, {
      registry: globalServiceRegistry,
      resourceScope: undefined,
      inputStreams: undefined,
      onProgress: async () => {},
      own: (i) => i,
      disown: () => {},
    });

    expect(result).toEqual({ result: "final" });
  });
});

// ============================================================================
// CacheCoordinator
// ============================================================================

type CacheableInput = { q: string };
type CacheableOutput = { result: string };

class CacheableStreamingTask extends Task<CacheableInput, CacheableOutput> {
  public static override readonly type = "TestCacheableStreaming";
  public static override readonly category = "Test";
  public static override readonly cacheable = true;
  public static override readonly title = "Cacheable";
  public static override readonly description = "Cacheable";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { q: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "string", "x-stream": "append" } },
    } as const satisfies DataPortSchema;
  }
  public override async execute(input: CacheableInput): Promise<CacheableOutput> {
    return { result: input.q };
  }
}

class NonCacheableStreamingTask extends Task<CacheableInput, CacheableOutput> {
  public static override readonly type = "TestNonCacheableStreaming";
  public static override readonly category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override readonly title = "NonCacheable";
  public static override readonly description = "NonCacheable";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { q: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "string", "x-stream": "append" } },
    } as const satisfies DataPortSchema;
  }
  public override async execute(input: CacheableInput): Promise<CacheableOutput> {
    return { result: input.q };
  }
}

class FakeCacheRepo {
  private store = new Map<string, unknown>();

  async getOutput(type: string, input: unknown): Promise<unknown> {
    return this.store.get(`${type}::${JSON.stringify(input)}`);
  }

  async saveOutput(type: string, input: unknown, output: unknown): Promise<void> {
    this.store.set(`${type}::${JSON.stringify(input)}`, output);
  }
}

describe("CacheCoordinator", () => {
  it("lookup hit emits stream_start/finish/end for streamable tasks", async () => {
    TaskRegistry.registerTask(CacheableStreamingTask);
    const task = new CacheableStreamingTask();
    const cache = new FakeCacheRepo() as any;

    // Pre-populate the cache
    await cache.saveOutput("TestCacheableStreaming", { q: "hello" }, { result: "cached!" });

    const cc = new CacheCoordinator<CacheableInput, CacheableOutput>(task);
    const ctx = new TaskRunContext();

    const events: string[] = [];
    task.subscribe("stream_start", () => events.push("start"));
    task.subscribe("stream_chunk", (event: any) => events.push(`chunk:${event.type}`));
    task.subscribe("stream_end", () => events.push("end"));

    const result = await cc.lookup({ q: "hello" }, cache, { kind: "deterministic" }, true, ctx);

    expect(result).toEqual({ result: "cached!" });
    expect(events).toEqual(["start", "chunk:finish", "end"]);
  });

  it("save no-op when outputCache is undefined or task is not cacheable", async () => {
    TaskRegistry.registerTask(CacheableStreamingTask);
    const task = new CacheableStreamingTask();
    const cc = new CacheCoordinator<CacheableInput, CacheableOutput>(task);

    // Should not throw, should not record anything (cache=undefined)
    await cc.save({ q: "x" }, { result: "y" }, undefined, { kind: "deterministic" });

    // With a cache but a non-cacheable task - verify by using a separate non-cacheable task class
    TaskRegistry.registerTask(NonCacheableStreamingTask);
    const nonCacheableTask = new NonCacheableStreamingTask();
    const cc2 = new CacheCoordinator<CacheableInput, CacheableOutput>(nonCacheableTask);
    const cache = new FakeCacheRepo() as any;

    await cc2.save({ q: "x" }, { result: "y" }, cache, { kind: "deterministic" });

    const cached = await cache.getOutput("TestNonCacheableStreaming", { q: "x" });
    expect(cached).toBeUndefined();
  });
});
