/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, IRunConfig, StreamEvent } from "@workglow/task-graph";
import { Task, TaskStatus, getOutputStreamMode, isTaskStreamable } from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";

// ============================================================================
// Test Tasks
// ============================================================================

type StreamTestInput = { prompt: string };
type StreamTestOutput = { text: string };

/**
 * A test task that streams in append mode (text-delta chunks).
 * Yields 3 text-delta events, then a finish with empty data.
 */
class TestStreamingAppendTask extends Task<StreamTestInput, StreamTestOutput> {
  public static override type = "TestStreamingAppendTask";
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
    _input: StreamTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StreamTestOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Hello" };
    yield { type: "text-delta", port: "text", textDelta: " " };
    yield { type: "text-delta", port: "text", textDelta: "world" };
    yield { type: "finish", data: {} as StreamTestOutput };
  }
}

/**
 * A test task that streams in replace mode (snapshot chunks).
 * Yields 3 snapshot events, then a finish with the final snapshot.
 */
class TestStreamingReplaceTask extends Task<StreamTestInput, StreamTestOutput> {
  public static override type = "TestStreamingReplaceTask";
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
    _input: StreamTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StreamTestOutput>> {
    yield { type: "snapshot", data: { text: "Bon" } };
    yield { type: "snapshot", data: { text: "Bonjour" } };
    yield { type: "snapshot", data: { text: "Bonjour le monde" } };
    yield { type: "finish", data: { text: "Bonjour le monde" } };
  }
}

/**
 * A test task that errors mid-stream after 2 chunks.
 */
class TestStreamingErrorTask extends Task<StreamTestInput, StreamTestOutput> {
  public static override type = "TestStreamingErrorTask";
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
    _input: StreamTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StreamTestOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Hello" };
    yield { type: "text-delta", port: "text", textDelta: " " };
    yield { type: "error", error: new Error("Stream error after 2 chunks") };
  }
}

/**
 * A test task that can be aborted mid-stream.
 */
class TestStreamingAbortableTask extends Task<StreamTestInput, StreamTestOutput> {
  public static override type = "TestStreamingAbortableTask";
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
    _input: StreamTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StreamTestOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Hello" };
    // Wait a bit so the test can abort mid-stream
    await sleep(100);
    if (context.signal.aborted) {
      return;
    }
    yield { type: "text-delta", port: "text", textDelta: " world" };
    yield { type: "finish", data: {} as StreamTestOutput };
  }
}

/**
 * A test task that streams in append mode using a non-text port name ("code").
 */
type CodeTestInput = { prompt: string };
type CodeTestOutput = { code: string };

class TestStreamingCodeAppendTask extends Task<CodeTestInput, CodeTestOutput> {
  public static override type = "TestStreamingCodeAppendTask";
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
        code: { type: "string", "x-stream": "append" },
      },
      required: ["code"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: CodeTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<CodeTestOutput>> {
    yield { type: "text-delta", port: "code", textDelta: "fn main() {" };
    yield { type: "text-delta", port: "code", textDelta: ' println!("hi")' };
    yield { type: "text-delta", port: "code", textDelta: " }" };
    yield { type: "finish", data: {} as CodeTestOutput };
  }
}

// ============================================================================
// Object-delta (tool calls) test task
// ============================================================================

type ToolCallItem = { id: string; name: string; arguments: string };
type ToolCallInput = { prompt: string };
type ToolCallOutput = { toolCalls: ToolCallItem[] };

/**
 * A task that streams tool calls as single-element `object-delta` array
 * chunks. Mirrors the delta convention used by AI providers (OpenAI,
 * Anthropic, Gemini) after the streaming fix.
 *
 * Chunk sequence:
 *  1. toolCall "tc1" first fragment (arguments partial)
 *  2. toolCall "tc1" updated (arguments complete)
 *  3. toolCall "tc2" first (and only) fragment
 *  4. finish with empty payload
 */
class TestStreamingToolCallTask extends Task<ToolCallInput, ToolCallOutput> {
  public static override type = "TestStreamingToolCallTask";
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
        toolCalls: { type: "array", "x-stream": "object" },
      },
      required: ["toolCalls"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: ToolCallInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<ToolCallOutput>> {
    // Chunk 1: first fragment of tc1 (partial arguments)
    yield {
      type: "object-delta",
      port: "toolCalls",
      objectDelta: [{ id: "tc1", name: "get_weather", arguments: '{"loc' }],
    };
    // Chunk 2: tc1 updated with complete arguments (same id → upsert)
    yield {
      type: "object-delta",
      port: "toolCalls",
      objectDelta: [{ id: "tc1", name: "get_weather", arguments: '{"location":"NYC"}' }],
    };
    // Chunk 3: brand-new tool call tc2 (different id → append)
    yield {
      type: "object-delta",
      port: "toolCalls",
      objectDelta: [{ id: "tc2", name: "get_time", arguments: "{}" }],
    };
    yield { type: "finish", data: {} as ToolCallOutput };
  }
}

/**
 * A task that streams a non-array object-delta (structured generation).
 * Each chunk should *replace* (not merge) the previous state.
 */
type StructuredInput = { prompt: string };
type StructuredOutput = { result: Record<string, unknown> };

class TestStreamingStructuredTask extends Task<StructuredInput, StructuredOutput> {
  public static override type = "TestStreamingStructuredTask";
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
        result: { type: "object", "x-stream": "object" },
      },
      required: ["result"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: StructuredInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<StructuredOutput>> {
    yield {
      type: "object-delta",
      port: "result",
      objectDelta: { name: "Al" },
    };
    yield {
      type: "object-delta",
      port: "result",
      objectDelta: { name: "Alice", age: 30 },
    };
    yield { type: "finish", data: {} as StructuredOutput };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("TaskRunner Streaming", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("Append Mode", () => {
    it("should emit stream_start, stream_chunk, and stream_end events", async () => {
      const task = new TestStreamingAppendTask({ defaults: { prompt: "test" } });

      const events: string[] = [];
      const chunks: StreamEvent[] = [];

      task.on("stream_start", () => events.push("stream_start"));
      task.on("stream_chunk", (event) => {
        events.push("stream_chunk");
        chunks.push(event);
      });
      task.on("stream_end", () => events.push("stream_end"));

      await task.run({ prompt: "test" });

      expect(events).toContain("stream_start");
      expect(events).toContain("stream_end");
      expect(events.filter((e) => e === "stream_chunk").length).toBe(4); // 3 deltas + 1 finish
      expect(chunks[0]).toEqual({ type: "text-delta", port: "text", textDelta: "Hello" });
      expect(chunks[1]).toEqual({ type: "text-delta", port: "text", textDelta: " " });
      expect(chunks[2]).toEqual({ type: "text-delta", port: "text", textDelta: "world" });
      expect(chunks[3].type).toBe("finish");
    });

    it("should transition through PENDING -> PROCESSING -> STREAMING -> COMPLETED", async () => {
      const task = new TestStreamingAppendTask({ defaults: { prompt: "test" } });

      const statuses: TaskStatus[] = [];
      task.on("status", (status) => statuses.push(status));

      await task.run({ prompt: "test" });

      expect(statuses).toContain(TaskStatus.PROCESSING);
      expect(statuses).toContain(TaskStatus.STREAMING);
      expect(statuses).toContain(TaskStatus.COMPLETED);

      // STREAMING should come after PROCESSING
      const processingIdx = statuses.indexOf(TaskStatus.PROCESSING);
      const streamingIdx = statuses.indexOf(TaskStatus.STREAMING);
      const completedIdx = statuses.indexOf(TaskStatus.COMPLETED);
      expect(streamingIdx).toBeGreaterThan(processingIdx);
      expect(completedIdx).toBeGreaterThan(streamingIdx);
    });

    it("should accumulate text even when cache is off", async () => {
      const task = new TestStreamingAppendTask({ cacheable: false, defaults: { prompt: "test" } });

      const result = await task.run({ prompt: "test" });

      // In append mode, text-delta chunks are always accumulated regardless
      // of whether output cache is enabled
      expect(task.runOutputData.text).toBe("Hello world");
      expect(result.text).toBe("Hello world");
    });

    it("should accumulate text when output cache is enabled", async () => {
      const cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();

      const task = new TestStreamingAppendTask(
        { defaults: { prompt: "test" } },
        { outputCache: cache }
      );

      const result = await task.run({ prompt: "test" });

      // With cache enabled, the runner accumulates text-delta chunks
      expect(task.runOutputData.text).toBe("Hello world");
      expect(result.text).toBe("Hello world");

      // Verify it was actually cached
      const cached = await cache.getOutput("TestStreamingAppendTask", {
        prompt: "test",
        __cv: "1",
      });
      expect(cached).toBeDefined();
      expect((cached as any)?.text).toBe("Hello world");
    });

    it("should serve from cache on second run (cache hit)", async () => {
      const cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();

      const task1 = new TestStreamingAppendTask(
        { defaults: { prompt: "test" } },
        { outputCache: cache }
      );
      await task1.run({ prompt: "test" });

      // Second run should hit cache
      const task2 = new TestStreamingAppendTask(
        { defaults: { prompt: "test" } },
        { outputCache: cache }
      );

      const events: string[] = [];
      const chunks: StreamEvent[] = [];
      task2.on("stream_start", () => events.push("stream_start"));
      task2.on("stream_chunk", (event) => {
        events.push("stream_chunk");
        chunks.push(event);
      });
      task2.on("stream_end", () => events.push("stream_end"));

      const result = await task2.run({ prompt: "test" });

      // Cache hit: should emit stream_start, one finish chunk, stream_end
      expect(events).toContain("stream_start");
      expect(events).toContain("stream_end");
      expect(chunks.length).toBe(1);
      expect(chunks[0].type).toBe("finish");
      if (chunks[0].type === "finish") {
        expect(chunks[0].data.text).toBe("Hello world");
      }
      expect(result.text).toBe("Hello world");
    });

    it("should report progress during streaming", async () => {
      const task = new TestStreamingAppendTask({ defaults: { prompt: "test" } });

      const progressValues: Array<number | undefined> = [];
      task.on("progress", (progress: number | undefined) => progressValues.push(progress));

      await task.run({ prompt: "test" });

      expect(progressValues.length).toBeGreaterThan(0);
      // Progress should be increasing
      for (let i = 1; i < progressValues.length; i++) {
        if (progressValues[i] === undefined || progressValues[i - 1] === undefined) {
          throw new Error("Expected progress values to be defined");
        }
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]!);
      }
      // Final progress should be 100 (set by handleComplete)
      expect(task.progress).toBe(100);
    });
  });

  describe("Replace Mode", () => {
    it("should emit snapshot chunks and update runOutputData on each", async () => {
      const task = new TestStreamingReplaceTask({ defaults: { prompt: "test" } });

      const snapshots: any[] = [];
      const runOutputSnapshots: any[] = [];

      task.on("stream_chunk", (event) => {
        if (event.type === "snapshot") {
          snapshots.push(event.data);
          // Capture runOutputData at time of chunk
          runOutputSnapshots.push({ ...task.runOutputData });
        }
      });

      await task.run({ prompt: "test" });

      expect(snapshots.length).toBe(3);
      expect(snapshots[0]).toEqual({ text: "Bon" });
      expect(snapshots[1]).toEqual({ text: "Bonjour" });
      expect(snapshots[2]).toEqual({ text: "Bonjour le monde" });

      // In replace mode, runOutputData is updated on each snapshot
      expect(runOutputSnapshots[0]).toEqual({ text: "Bon" });
      expect(runOutputSnapshots[1]).toEqual({ text: "Bonjour" });
      expect(runOutputSnapshots[2]).toEqual({ text: "Bonjour le monde" });
    });

    it("should have final snapshot in runOutputData after completion", async () => {
      const task = new TestStreamingReplaceTask({ defaults: { prompt: "test" } });

      const result = await task.run({ prompt: "test" });

      expect(task.runOutputData.text).toBe("Bonjour le monde");
      expect(result.text).toBe("Bonjour le monde");
    });

    it("should transition through STREAMING status", async () => {
      const task = new TestStreamingReplaceTask({ defaults: { prompt: "test" } });

      const statuses: TaskStatus[] = [];
      task.on("status", (status) => statuses.push(status));

      await task.run({ prompt: "test" });

      expect(statuses).toContain(TaskStatus.STREAMING);
      expect(statuses).toContain(TaskStatus.COMPLETED);
    });

    it("should cache the final snapshot with output cache enabled", async () => {
      const cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();

      const task = new TestStreamingReplaceTask(
        { defaults: { prompt: "test" } },
        { outputCache: cache }
      );

      await task.run({ prompt: "test" });

      const cached = await cache.getOutput("TestStreamingReplaceTask", {
        prompt: "test",
        __cv: "1",
      });
      expect(cached).toBeDefined();
      expect((cached as any)?.text).toBe("Bonjour le monde");
    });
  });

  describe("Error Handling", () => {
    it("should throw and transition to FAILED on stream error", async () => {
      const task = new TestStreamingErrorTask({ defaults: { prompt: "test" } });

      const statuses: TaskStatus[] = [];
      task.on("status", (status) => statuses.push(status));

      await expect(task.run({ prompt: "test" })).rejects.toThrow("Stream error after 2 chunks");

      expect(task.status).toBe(TaskStatus.FAILED);
      expect(statuses).toContain(TaskStatus.FAILED);
    });

    it("should emit error event on stream error", async () => {
      const task = new TestStreamingErrorTask({ defaults: { prompt: "test" } });

      const errors: Error[] = [];
      task.on("error", (err) => errors.push(err));

      try {
        await task.run({ prompt: "test" });
      } catch {
        // Expected
      }

      expect(errors.length).toBe(1);
    });
  });

  describe("Abort Handling", () => {
    it("should abort a streaming task mid-stream", async () => {
      const task = new TestStreamingAbortableTask({ defaults: { prompt: "test" } });

      const chunks: StreamEvent[] = [];
      task.on("stream_chunk", (event) => chunks.push(event));

      // Start the task, then abort after a short delay
      const runPromise = task.run({ prompt: "test" });

      // Give the first chunk time to emit, then abort
      await sleep(30);
      task.abort();

      try {
        await runPromise;
      } catch {
        // Expected - abort causes error
      }

      // Should have received at least the first chunk
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(task.status).toBe(TaskStatus.ABORTING);
    });
  });

  describe("Non-text append port", () => {
    it("should accumulate text-deltas into the correct port name (code)", async () => {
      const task = new TestStreamingCodeAppendTask({ defaults: { prompt: "test" } });

      const result = await task.run({ prompt: "test" });

      expect(result.code).toBe('fn main() { println!("hi") }');
      expect(task.runOutputData).toHaveProperty("code");
      expect(task.runOutputData.code).toBe('fn main() { println!("hi") }');
    });

    it("should emit stream events for non-text port", async () => {
      const task = new TestStreamingCodeAppendTask({ defaults: { prompt: "test" } });

      const chunks: StreamEvent[] = [];
      task.on("stream_chunk", (event) => chunks.push(event));

      await task.run({ prompt: "test" });

      expect(chunks.filter((c) => c.type === "text-delta").length).toBe(3);
      expect(chunks.find((c) => c.type === "finish")).toBeDefined();
    });
  });

  describe("Port-level streaming detection", () => {
    it("should detect streaming via x-stream on output schema", async () => {
      const task = new TestStreamingAppendTask({ defaults: { prompt: "test" } });
      // isTaskStreamable checks output schema for x-stream and executeStream presence
      expect(isTaskStreamable(task)).toBe(true);
      expect(getOutputStreamMode(task.outputSchema())).toBe("append");
    });

    it("should detect replace mode via x-stream on output schema", () => {
      const task = new TestStreamingReplaceTask({ defaults: { prompt: "test" } });
      expect(getOutputStreamMode(task.outputSchema())).toBe("replace");
    });

    it("should use config streamMode when running append task with cache", async () => {
      const cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();

      const task = new TestStreamingAppendTask(
        { defaults: { prompt: "config-test" } },
        { outputCache: cache }
      );

      const result = await task.run({ prompt: "config-test" });

      expect(result.text).toBe("Hello world");
    });
  });

  describe("Object-delta (tool calls)", () => {
    it("should upsert a tool call when the same id arrives in multiple chunks", async () => {
      const task = new TestStreamingToolCallTask({ defaults: { prompt: "test" } });

      const result = await task.run({ prompt: "test" });

      // tc1 should have been upserted (second chunk overwrites first)
      const tc1 = (result.toolCalls as ToolCallItem[]).find((t) => t.id === "tc1");
      expect(tc1).toBeDefined();
      expect(tc1!.arguments).toBe('{"location":"NYC"}');
    });

    it("should accumulate tool calls with different ids into a single array", async () => {
      const task = new TestStreamingToolCallTask({ defaults: { prompt: "test" } });

      const result = await task.run({ prompt: "test" });

      expect(result.toolCalls).toHaveLength(2);
      const ids = (result.toolCalls as ToolCallItem[]).map((t) => t.id);
      expect(ids).toContain("tc1");
      expect(ids).toContain("tc2");
    });

    it("should enrich the finish event with accumulated tool calls (shouldAccumulate=true)", async () => {
      const task = new TestStreamingToolCallTask({ defaults: { prompt: "test" } });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      await task.run({ prompt: "test" });

      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      const toolCalls = (finishEvent!.data as any).toolCalls as ToolCallItem[];
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls.find((t) => t.id === "tc1")?.arguments).toBe('{"location":"NYC"}');
      expect(toolCalls.find((t) => t.id === "tc2")?.name).toBe("get_time");
    });

    it("should emit raw empty finish when shouldAccumulate=false", async () => {
      const task = new TestStreamingToolCallTask({ defaults: { prompt: "test" } });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const config: IRunConfig = { shouldAccumulate: false };
      await task.runner.run({ prompt: "test" }, config);

      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      // No accumulation: finish payload is the raw empty object from the provider
      expect(finishEvent!.data).toEqual({});
    });

    it("should update runOutputData with the growing accumulated array on each chunk", async () => {
      const task = new TestStreamingToolCallTask({ defaults: { prompt: "test" } });

      const snapshots: ToolCallItem[][] = [];
      task.on("stream_chunk", (e) => {
        if (e.type === "object-delta") {
          snapshots.push([...((task.runOutputData?.toolCalls ?? []) as ToolCallItem[])]);
        }
      });

      await task.run({ prompt: "test" });

      // After chunk 1: only tc1 (partial)
      expect(snapshots[0]).toHaveLength(1);
      expect(snapshots[0][0].id).toBe("tc1");
      // After chunk 2: still 1 item (tc1 upserted)
      expect(snapshots[1]).toHaveLength(1);
      expect(snapshots[1][0].arguments).toBe('{"location":"NYC"}');
      // After chunk 3: tc2 added
      expect(snapshots[2]).toHaveLength(2);
    });

    it("should apply replace semantics for non-array object-delta (structured generation)", async () => {
      const task = new TestStreamingStructuredTask({ defaults: { prompt: "test" } });

      const result = await task.run({ prompt: "test" });

      // Each non-array chunk replaces the previous; final value is the last chunk
      expect((result.result as any).name).toBe("Alice");
      expect((result.result as any).age).toBe(30);
    });

    it("should replace, not merge, earlier partial structured output with later chunks", async () => {
      const task = new TestStreamingStructuredTask({ defaults: { prompt: "test" } });

      const snapshots: Record<string, unknown>[] = [];
      task.on("stream_chunk", (e) => {
        if (e.type === "object-delta") {
          snapshots.push({ ...(task.runOutputData?.result as Record<string, unknown>) });
        }
      });

      await task.run({ prompt: "test" });

      // First chunk: only `name` partial
      expect(snapshots[0]).toEqual({ name: "Al" });
      // Second chunk: full object, NOT merged with first
      expect(snapshots[1]).toEqual({ name: "Alice", age: 30 });
      // `age` should NOT appear in the first snapshot (replace, not merge)
      expect(snapshots[0]).not.toHaveProperty("age");
    });
  });
});
