/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { Task, TaskStatus } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";
import { getTestingLogger } from "../../binding/TestingLogger";

// ============================================================================
// Test Tasks
// ============================================================================

type CacheTestInput = { prompt: string };
type CacheTestOutput = { text: string };

/**
 * Append-mode streaming task for cache testing.
 * Tracks how many times executeStream is called.
 */
let appendStreamCallCount = 0;

class CacheAppendStreamTask extends Task<CacheTestInput, CacheTestOutput> {
  public static override type = "CacheAppendStreamTask";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: CacheTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<CacheTestOutput>> {
    appendStreamCallCount++;
    yield { type: "text-delta", port: "text", textDelta: "cached " };
    yield { type: "text-delta", port: "text", textDelta: "result" };
    yield { type: "finish", data: {} as CacheTestOutput };
  }
}

/**
 * Replace-mode streaming task for cache testing.
 */
let replaceStreamCallCount = 0;

class CacheReplaceStreamTask extends Task<CacheTestInput, CacheTestOutput> {
  public static override type = "CacheReplaceStreamTask";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "replace" },
      },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: CacheTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<CacheTestOutput>> {
    replaceStreamCallCount++;
    yield { type: "snapshot", data: { text: "partial" } };
    yield { type: "snapshot", data: { text: "complete result" } };
    yield { type: "finish", data: { text: "complete result" } };
  }
}

/**
 * Append-mode task with caching explicitly disabled.
 */
class NoCacheAppendStreamTask extends Task<CacheTestInput, CacheTestOutput> {
  public static override type = "NoCacheAppendStreamTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: CacheTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<CacheTestOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "no-cache " };
    yield { type: "text-delta", port: "text", textDelta: "output" };
    yield { type: "finish", data: {} as CacheTestOutput };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("Streaming Cache Integration", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let cache: InMemoryTaskOutputRepository;

  beforeEach(async () => {
    cache = new InMemoryTaskOutputRepository();
    await cache.setupDatabase();
    appendStreamCallCount = 0;
    replaceStreamCallCount = 0;
  });

  describe("Append mode with cache", () => {
    it("should execute stream and cache the accumulated result on first run", async () => {
      const task = new CacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );

      const result = await task.run({ prompt: "hello" });

      // Stream should have executed
      expect(appendStreamCallCount).toBe(1);

      // Runner should have accumulated text-delta chunks
      expect(result.text).toBe("cached result");
      expect(task.runOutputData.text).toBe("cached result");

      // Verify the result was cached; __cv is the cacheVersion sentinel injected by buildKey
      const cached = await cache.getOutput("CacheAppendStreamTask", { prompt: "hello", __cv: "1" });
      expect(cached).toBeDefined();
      expect((cached as any).text).toBe("cached result");
    });

    it("should serve from cache on second run without executing stream", async () => {
      // First run: populates cache
      const task1 = new CacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );
      await task1.run({ prompt: "hello" });
      expect(appendStreamCallCount).toBe(1);

      // Second run: should hit cache
      const task2 = new CacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );

      const events: StreamEvent[] = [];
      task2.on("stream_chunk", (event) => events.push(event));

      const result = await task2.run({ prompt: "hello" });

      // Stream should NOT have been called again
      expect(appendStreamCallCount).toBe(1);

      // Cache hit emits a single finish chunk
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("finish");
      if (events[0].type === "finish") {
        expect(events[0].data.text).toBe("cached result");
      }

      // Result should match cached value
      expect(result.text).toBe("cached result");
    });

    it("should emit stream_start and stream_end on cache hit", async () => {
      // Populate cache
      const task1 = new CacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );
      await task1.run({ prompt: "hello" });

      // Cache hit
      const task2 = new CacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );

      const lifecycle: string[] = [];
      task2.on("stream_start", () => lifecycle.push("stream_start"));
      task2.on("stream_end", () => lifecycle.push("stream_end"));

      await task2.run({ prompt: "hello" });

      expect(lifecycle).toContain("stream_start");
      expect(lifecycle).toContain("stream_end");
    });

    it("should complete instantly on cache hit", async () => {
      // Populate cache
      const task1 = new CacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );
      await task1.run({ prompt: "hello" });

      // Cache hit should complete with COMPLETED status
      const task2 = new CacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );

      const statuses: TaskStatus[] = [];
      task2.on("status", (s) => statuses.push(s));

      await task2.run({ prompt: "hello" });

      expect(task2.status).toBe(TaskStatus.COMPLETED);
      // Should NOT have STREAMING status (cache hit is instant)
      expect(statuses).not.toContain(TaskStatus.STREAMING);
    });
  });

  describe("Replace mode with cache", () => {
    it("should cache the final snapshot on first run", async () => {
      const task = new CacheReplaceStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );

      const result = await task.run({ prompt: "hello" });

      expect(replaceStreamCallCount).toBe(1);
      expect(result.text).toBe("complete result");

      // __cv is the cacheVersion sentinel injected by buildKey
      const cached = await cache.getOutput("CacheReplaceStreamTask", {
        prompt: "hello",
        __cv: "1",
      });
      expect(cached).toBeDefined();
      expect((cached as any).text).toBe("complete result");
    });

    it("should serve from cache on second run", async () => {
      // First run
      const task1 = new CacheReplaceStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );
      await task1.run({ prompt: "hello" });

      // Second run: cache hit
      const task2 = new CacheReplaceStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );

      const result = await task2.run({ prompt: "hello" });

      expect(replaceStreamCallCount).toBe(1); // No second stream execution
      expect(result.text).toBe("complete result");
    });
  });

  describe("Cache disabled (still accumulates)", () => {
    it("should accumulate text even when cache is disabled", async () => {
      const task = new NoCacheAppendStreamTask({ defaults: { prompt: "hello" } });

      const chunks: StreamEvent[] = [];
      task.on("stream_chunk", (event) => chunks.push(event));

      const result = await task.run({ prompt: "hello" });

      // All chunks should have been emitted
      expect(chunks.length).toBe(3); // 2 text-delta + 1 finish

      // Text-delta chunks are always accumulated in append mode,
      // regardless of cache configuration
      expect(result.text).toBe("no-cache output");
    });

    it("should not attempt to save to cache when cacheable is false", async () => {
      // Provide a cache instance but set cacheable=false on the task class
      const task = new NoCacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );

      await task.run({ prompt: "hello" });

      // Cache should be empty since the task is not cacheable
      const cached = await cache.getOutput("NoCacheAppendStreamTask", { prompt: "hello" });
      expect(cached).toBeUndefined();
    });
  });

  describe("Different inputs produce different cache entries", () => {
    it("should cache separately for different inputs", async () => {
      const task1 = new CacheAppendStreamTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );
      await task1.run({ prompt: "hello" });

      const task2 = new CacheAppendStreamTask(
        { defaults: { prompt: "world" } },
        { outputCache: cache }
      );
      await task2.run({ prompt: "world" });

      // Both should have been executed
      expect(appendStreamCallCount).toBe(2);

      // Both should be cached; __cv is the cacheVersion sentinel injected by buildKey
      const cached1 = await cache.getOutput("CacheAppendStreamTask", {
        prompt: "hello",
        __cv: "1",
      });
      const cached2 = await cache.getOutput("CacheAppendStreamTask", {
        prompt: "world",
        __cv: "1",
      });
      expect(cached1).toBeDefined();
      expect(cached2).toBeDefined();
    });
  });
});
