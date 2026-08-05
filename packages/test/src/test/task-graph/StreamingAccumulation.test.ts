/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the source-task streaming accumulation system.
 *
 * Design principle: accumulation of streaming text-deltas happens once in the
 * source task (when shouldAccumulate=true), producing an enriched finish event
 * that carries the fully-assembled port data.  All downstream dataflow edges
 * share that enriched finish via tee'd ReadableStreams so no edge needs to
 * re-accumulate independently.
 *
 * Tests cover:
 *  - TaskRunner: enriched finish event is emitted when shouldAccumulate=true
 *  - TaskRunner: raw finish is emitted when shouldAccumulate=false
 *  - TaskGraphRunner.taskNeedsAccumulation: true when downstream is non-streaming
 *  - TaskGraphRunner.taskNeedsAccumulation: false when all downstream are streaming
 *  - Graph execution: append-mode task -> non-streaming consumer (materialises correctly)
 *  - Graph execution: replace-mode task with text-deltas -> non-streaming consumer
 *  - Graph execution: fan-out to multiple non-streaming consumers (single accumulation)
 *  - Cache: auto-enables accumulation
 */

import type { CachePolicy, StreamEvent, Usage ,
  IExecuteContext,
  IRunConfig,
  StreamFinish} from "@workglow/task-graph";
import {
  Dataflow,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
} from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";
import { getTestingLogger } from "../../binding/TestingLogger";

// ============================================================================
// Test task definitions
// ============================================================================

type SimpleInput = { prompt: string };
type SimpleOutput = { text: string };

/**
 * Append-mode task that emits text-delta chunks and an empty finish payload.
 * Mirrors real provider behavior (e.g. OpenAI, HFT TextRewriter).
 */
class AppendTask extends Task<SimpleInput, SimpleOutput> {
  public static override type = "AccumTest_AppendTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string", default: "test" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SimpleInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "hello" };
    yield { type: "text-delta", port: "text", textDelta: " world" };
    // Empty finish -- source task must enrich this when shouldAccumulate=true
    yield { type: "finish", data: {} as SimpleOutput };
  }

  override async execute(_input: SimpleInput): Promise<SimpleOutput | undefined> {
    return { text: "hello world" };
  }
}

/**
 * Replace-mode task that emits text-delta chunks (like HFT TextTranslation).
 * Real translators stream tokens even though the schema declares replace mode.
 */
class ReplaceWithTextDeltasTask extends Task<SimpleInput, SimpleOutput> {
  public static override type = "AccumTest_ReplaceWithTextDeltasTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string", default: "test" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "replace" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SimpleInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Bonjour" };
    yield { type: "text-delta", port: "text", textDelta: " monde" };
    // finish carries partial data (no "text" key) -- source task must merge accumulated
    yield { type: "finish", data: {} as SimpleOutput };
  }

  override async execute(_input: SimpleInput): Promise<SimpleOutput | undefined> {
    return { text: "Bonjour monde" };
  }
}

/**
 * Streaming-input, streaming-output consumer that acts as a pass-through.
 * The source task should NOT accumulate when all edges go to streaming tasks.
 */
class StreamPassThroughTask extends Task<SimpleInput, SimpleOutput> {
  public static override type = "AccumTest_StreamPassThroughTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", default: "", "x-stream": "append" } },
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
    input: any,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: `pass:${input.text ?? ""}` };
    yield { type: "finish", data: { text: `pass:${input.text ?? ""}` } };
  }

  override async execute(input: any): Promise<SimpleOutput | undefined> {
    return { text: `pass:${input.text ?? ""}` };
  }
}

/**
 * Non-streaming consumer that needs a materialised text value.
 */
class SinkTask extends Task<SimpleInput, SimpleOutput> {
  public static override type = "AccumTest_SinkTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", default: "" } },
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

  override async execute(input: any): Promise<SimpleOutput | undefined> {
    return { text: `sink:${input.text ?? ""}` };
  }
}

/**
 * Cacheable append-mode task for cache + accumulation tests.
 */
class CacheableAppendTask extends Task<SimpleInput, SimpleOutput> {
  public static override type = "AccumTest_CacheableAppendTask";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SimpleInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "cached" };
    yield { type: "text-delta", port: "text", textDelta: " value" };
    yield { type: "finish", data: {} as SimpleOutput };
  }

  override async execute(_input: SimpleInput): Promise<SimpleOutput | undefined> {
    return { text: "cached value" };
  }
}

function mkUsage(partial: Partial<Usage>): Usage {
  return {
    input: undefined,
    output: undefined,
    cached: undefined,
    cacheWrite: undefined,
    reasoning: undefined,
    total: undefined,
    extra: undefined,
    ...partial,
  };
}

const TASK_USAGE = mkUsage({ input: 25, output: 7, cached: 20, total: 32 });

/**
 * Append-mode task whose finish carries a `usage` sibling, mirroring a provider
 * that reports token counts.
 */
class UsageAppendTask extends Task<SimpleInput, SimpleOutput> {
  public static override type = "AccumTest_UsageAppendTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string", default: "test" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SimpleInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "hello" };
    yield { type: "text-delta", port: "text", textDelta: " world" };
    yield { type: "finish", data: {} as SimpleOutput, usage: TASK_USAGE };
  }
}

/**
 * Cacheable variant used to prove a cache hit does not replay token counts.
 */
class UsageCacheableTask extends Task<SimpleInput, SimpleOutput> {
  public static override type = "AccumTest_UsageCacheableTask";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SimpleInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "billed" };
    yield { type: "finish", data: {} as SimpleOutput, usage: TASK_USAGE };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function makeGraph(): { graph: TaskGraph; runner: TaskGraphRunner } {
  const graph = new TaskGraph();
  const runner = new TaskGraphRunner(graph);
  return { graph, runner };
}

// ============================================================================
// Tests
// ============================================================================

describe("Source-task streaming accumulation", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("TaskRunner: shouldAccumulate flag", () => {
    it("should emit enriched finish event when shouldAccumulate=true (default)", async () => {
      const task = new AppendTask({ defaults: { prompt: "test" } });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const result = await task.run({ prompt: "test" });

      // Text-deltas are emitted as-is
      expect(emitted.filter((e) => e.type === "text-delta").length).toBe(2);

      // Finish event should be enriched with accumulated text
      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      expect(finishEvent!.data.text).toBe("hello world");

      // Final output is accumulated
      expect(result.text).toBe("hello world");
    });

    it("should NOT accumulate and emit raw finish when shouldAccumulate=false", async () => {
      // shouldAccumulate is passed via IRunConfig to TaskRunner.run(), not Task.run()
      // (Task.run() only accepts overrides; the graph runner uses runner.run() directly).
      const task = new AppendTask({ defaults: { prompt: "test" } });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const config: IRunConfig = { shouldAccumulate: false };
      const result = await task.runner.run({ prompt: "test" }, config);

      // Finish event should be the raw empty payload (no accumulation)
      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      expect(finishEvent!.data).toEqual({});

      // finalOutput is also empty (raw finish from provider)
      expect(result.text).toBeUndefined();
    });

    it("should accumulate text-deltas for replace-mode task and enrich finish", async () => {
      // Replace-mode task with text-delta events (like HFT TextTranslation)
      const task = new ReplaceWithTextDeltasTask({ defaults: { prompt: "test" } });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const result = await task.run({ prompt: "test" });

      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      expect(finishEvent!.data.text).toBe("Bonjour monde");

      expect(result.text).toBe("Bonjour monde");
    });

    it("should enrich finish by merging accumulated text into existing finish payload fields", async () => {
      // Task that produces both a text-delta field and other fields in finish
      class MixedFinishTask extends Task<SimpleInput, { text: string; lang: string }> {
        public static override type = "AccumTest_MixedFinishTask";
        public static override cachePolicy: CachePolicy = { kind: "none" };

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { prompt: { type: "string", default: "test" } },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              text: { type: "string", "x-stream": "replace" },
              lang: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        async *executeStream(
          _input: SimpleInput,
          _context: IExecuteContext
        ): AsyncIterable<StreamEvent<{ text: string; lang: string }>> {
          yield { type: "text-delta", port: "text", textDelta: "Hola" };
          yield { type: "text-delta", port: "text", textDelta: " mundo" };
          // finish carries lang but not text (like HFT_TextTranslation_Stream)
          yield { type: "finish", data: { lang: "es" } as any };
        }

        override async execute(
          _input: SimpleInput
        ): Promise<{ text: string; lang: string } | undefined> {
          return { text: "Hola mundo", lang: "es" };
        }
      }

      const task = new MixedFinishTask({ defaults: { prompt: "test" } });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const result = await task.run({ prompt: "test" });

      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      // Both accumulated text AND the original lang field should be present
      expect(finishEvent!.data.text).toBe("Hola mundo");
      expect(finishEvent!.data.lang).toBe("es");

      expect(result.text).toBe("Hola mundo");
      expect(result.lang).toBe("es");
    });
  });

  describe("TaskGraphRunner: taskNeedsAccumulation", () => {
    it("should accumulate when source connects to a non-streaming downstream", async () => {
      const { graph, runner } = makeGraph();

      const source = new AppendTask({ id: "source", defaults: { prompt: "test" } });
      const sink = new SinkTask({ id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("source", "text", "sink", "text"));

      const emittedFinish: StreamEvent[] = [];
      source.on("stream_chunk", (e) => {
        if (e.type === "finish") emittedFinish.push(e);
      });

      const results = await runner.runGraph({ prompt: "test" });

      // Source task should have been told to accumulate (enriched finish)
      expect(emittedFinish.length).toBe(1);
      const emittedFinishEvent = emittedFinish[0] as StreamFinish<{ text: string }>;
      expect(emittedFinishEvent.data.text).toBe("hello world");

      // Downstream sink should receive the accumulated value
      const sinkResult = results.find((r) => r.id === "sink");
      expect(sinkResult).toBeDefined();
      expect(sinkResult!.data.text).toBe("sink:hello world");
    });

    it("should NOT accumulate when all downstream edges connect to streaming tasks", async () => {
      const { graph, runner } = makeGraph();

      const source = new AppendTask({ id: "source", defaults: { prompt: "test" } });
      const passThroughA = new StreamPassThroughTask({ id: "pass-a" });
      const passThroughB = new StreamPassThroughTask({ id: "pass-b" });

      graph.addTasks([source, passThroughA, passThroughB]);
      // Both downstream tasks accept streaming input (x-stream: "append")
      graph.addDataflow(new Dataflow("source", "text", "pass-a", "text"));
      graph.addDataflow(new Dataflow("source", "text", "pass-b", "text"));

      const emittedBySource: StreamEvent[] = [];
      source.on("stream_chunk", (e) => emittedBySource.push(e));

      await runner.runGraph({ prompt: "test" });

      // Source should have emitted raw finish (no accumulation needed)
      const finishEvent = emittedBySource.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      // Raw finish from provider is empty {}
      expect(finishEvent!.data).toEqual({});
    });

    it("should accumulate when even one downstream is non-streaming (fan-out)", async () => {
      const { graph, runner } = makeGraph();

      const source = new AppendTask({ id: "source", defaults: { prompt: "test" } });
      const passThrough = new StreamPassThroughTask({ id: "stream-down" });
      const sink = new SinkTask({ id: "sink" });

      graph.addTasks([source, passThrough, sink]);
      graph.addDataflow(new Dataflow("source", "text", "stream-down", "text"));
      graph.addDataflow(new Dataflow("source", "text", "sink", "text"));

      const emittedFinish: StreamEvent[] = [];
      source.on("stream_chunk", (e) => {
        if (e.type === "finish") emittedFinish.push(e);
      });

      const results = await runner.runGraph({ prompt: "test" });

      // Source must accumulate because sink is non-streaming
      const emittedFinishEvent = emittedFinish[0] as StreamFinish<{ text: string }>;
      expect(emittedFinishEvent.data.text).toBe("hello world");

      // Sink receives the accumulated value
      const sinkResult = results.find((r) => r.id === "sink");
      expect(sinkResult!.data.text).toBe("sink:hello world");
    });
  });

  describe("Graph execution: replace-mode with text-deltas (HFT TextTranslation scenario)", () => {
    it("should materialise correct text for replace-mode task with text-delta events", async () => {
      const { graph, runner } = makeGraph();

      const source = new ReplaceWithTextDeltasTask({ id: "source", defaults: { prompt: "hello" } });
      const sink = new SinkTask({ id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("source", "text", "sink", "text"));

      const results = await runner.runGraph({ prompt: "hello" });

      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(sink.status).toBe(TaskStatus.COMPLETED);

      // Sink should have received "Bonjour monde" (accumulated from text-deltas)
      const sinkResult = results.find((r) => r.id === "sink");
      expect(sinkResult).toBeDefined();
      expect(sinkResult!.data.text).toBe("sink:Bonjour monde");
    });
  });

  describe("Graph execution: multiple non-streaming consumers (fan-out)", () => {
    it("should provide identical accumulated data to all non-streaming downstream tasks", async () => {
      const { graph, runner } = makeGraph();

      const source = new AppendTask({ id: "source", defaults: { prompt: "test" } });
      const sinkA = new SinkTask({ id: "sink-a" });
      const sinkB = new SinkTask({ id: "sink-b" });

      graph.addTasks([source, sinkA, sinkB]);
      graph.addDataflow(new Dataflow("source", "text", "sink-a", "text"));
      graph.addDataflow(new Dataflow("source", "text", "sink-b", "text"));

      const results = await runner.runGraph({ prompt: "test" });

      // Both sinks should receive the same accumulated value via tee'd enriched finish
      const resultA = results.find((r) => r.id === "sink-a");
      const resultB = results.find((r) => r.id === "sink-b");

      expect(resultA).toBeDefined();
      expect(resultB).toBeDefined();
      expect(resultA!.data.text).toBe("sink:hello world");
      expect(resultB!.data.text).toBe("sink:hello world");
    });
  });

  describe("Usage channel", () => {
    it("folds finish usage onto the run output's reserved usage field", async () => {
      const task = new UsageAppendTask({ defaults: { prompt: "test" } });
      const result = (await task.run({ prompt: "test" })) as SimpleOutput & { usage?: Usage };

      expect(result.text).toBe("hello world");
      expect(result.usage).toEqual(TASK_USAGE);
    });

    it("re-emits usage on the enriched finish event downstream consumers see", async () => {
      const task = new UsageAppendTask({ defaults: { prompt: "test" } });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      await task.run({ prompt: "test" });

      const finishEvent = emitted.find((e) => e.type === "finish") as
        (StreamFinish<{ text: string }> & { usage?: Usage }) | undefined;
      expect(finishEvent).toBeDefined();
      // The finish is enriched with accumulated text AND still carries usage.
      expect(finishEvent!.data.text).toBe("hello world");
      expect(finishEvent!.usage).toEqual(TASK_USAGE);
    });

    it("parity: run() and the streaming path report identical usage", async () => {
      const task = new UsageAppendTask({ defaults: { prompt: "test" } });
      let streamEndOutput: (SimpleOutput & { usage?: Usage }) | undefined;
      task.on("stream_end", (out) => {
        streamEndOutput = out as SimpleOutput & { usage?: Usage };
      });

      const runResult = (await task.run({ prompt: "test" })) as SimpleOutput & { usage?: Usage };

      expect(streamEndOutput?.usage).toEqual(runResult.usage);
      expect(runResult.usage).toEqual(TASK_USAGE);
    });

    it("leaves no usage key when the stream reported none", async () => {
      const task = new AppendTask({ defaults: { prompt: "test" } });
      const result = await task.run({ prompt: "test" });

      expect(result).toEqual({ text: "hello world" });
      expect("usage" in result).toBe(false);

      const finishFromEvents: StreamEvent[] = [];
      const task2 = new AppendTask({ defaults: { prompt: "test" } });
      task2.on("stream_chunk", (e) => finishFromEvents.push(e));
      await task2.run({ prompt: "test" });
      const finishEvent = finishFromEvents.find((e) => e.type === "finish")!;
      expect("usage" in finishEvent).toBe(false);
    });

    it("does not leak usage onto a downstream task's input", async () => {
      // Usage is a reserved field, not a port: it must not ride a dataflow edge.
      const { graph, runner } = makeGraph();
      const source = new UsageAppendTask({ id: "source", defaults: { prompt: "test" } });
      const sink = new SinkTask({ id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("source", "text", "sink", "text"));

      const results = await runner.runGraph({ prompt: "test" });

      const sinkResult = results.find((r) => r.id === "sink");
      expect(sinkResult!.data.text).toBe("sink:hello world");
      expect("usage" in sinkResult!.data).toBe(false);
    });
  });

  describe("Usage is not resurrected from the output cache", () => {
    let usageCache: InMemoryTaskOutputRepository;

    beforeEach(async () => {
      usageCache = new InMemoryTaskOutputRepository();
      await usageCache.setupDatabase();
    });

    it("strips usage on save so a cache hit reports no phantom tokens", async () => {
      const task1 = new UsageCacheableTask(
        { defaults: { prompt: "hello" } },
        { outputCache: usageCache }
      );
      const first = (await task1.run({ prompt: "hello" })) as SimpleOutput & { usage?: Usage };
      // The executed run IS billed.
      expect(first.usage).toEqual(TASK_USAGE);

      // The stored entry carries the value but not the token counts.
      const cached = await usageCache.getOutput("AccumTest_UsageCacheableTask", {
        prompt: "hello",
        __cv: "1",
      });
      expect(cached).toBeDefined();
      expect(cached!.text).toBe("billed");
      expect("usage" in cached!).toBe(false);

      // The cache hit cost zero tokens, so it must report none.
      const task2 = new UsageCacheableTask(
        { defaults: { prompt: "hello" } },
        { outputCache: usageCache }
      );
      const second = (await task2.run({ prompt: "hello" })) as SimpleOutput & { usage?: Usage };
      expect(second.text).toBe("billed");
      expect(second.usage).toBeUndefined();
    });
  });

  describe("Cache auto-enables accumulation", () => {
    let cache: InMemoryTaskOutputRepository;

    beforeEach(async () => {
      cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();
    });

    it("should accumulate when cache is active even with only streaming downstream", async () => {
      // Graph: source -> streamPassThrough. Normally shouldAccumulate=false (all streaming).
      // But cache is on so source must accumulate to have data to save.
      const { graph, runner } = makeGraph();

      const source = new CacheableAppendTask({ id: "source", defaults: { prompt: "test" } });
      const passThrough = new StreamPassThroughTask({ id: "pass" });

      graph.addTasks([source, passThrough]);
      graph.addDataflow(new Dataflow("source", "text", "pass", "text"));

      const emittedFinish: StreamEvent[] = [];
      source.on("stream_chunk", (e) => {
        if (e.type === "finish") emittedFinish.push(e);
      });

      await runner.runGraph({ prompt: "test" }, { outputCache: cache });

      // Source should have accumulated because cache is on
      expect(emittedFinish.length).toBe(1);
      const emittedFinishEvent = emittedFinish[0] as StreamFinish<{ text: string }>;
      expect(emittedFinishEvent.data.text).toBe("cached value");

      // Cached output should contain the accumulated text; __cv is the cacheVersion sentinel
      const cached = await cache.getOutput("AccumTest_CacheableAppendTask", {
        prompt: "test",
        __cv: "1",
      });
      expect(cached).toBeDefined();
      expect(cached!.text).toBe("cached value");
    });

    it("should cache accumulated result and serve it on second run", async () => {
      const task1 = new CacheableAppendTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );
      const result1 = await task1.run({ prompt: "hello" });
      expect(result1.text).toBe("cached value");

      // Second run: should hit cache
      const task2 = new CacheableAppendTask(
        { defaults: { prompt: "hello" } },
        { outputCache: cache }
      );
      const events: StreamEvent[] = [];
      task2.on("stream_chunk", (e) => events.push(e));

      const result2 = await task2.run({ prompt: "hello" });

      // Cache hit emits a single finish event with the cached data
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("finish");
      const emittedFinishEvent = events[0] as StreamFinish<{ text: string }>;
      expect(emittedFinishEvent.data.text).toBe("cached value");
      expect(result2.text).toBe("cached value");
    });
  });
});
