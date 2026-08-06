/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, StreamEvent } from "@workglow/task-graph";
import {
  Dataflow,
  getOutputStreamMode,
  GraphAsTask,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

// ============================================================================
// Test Tasks for DAG streaming
// ============================================================================

type TextInput = { prompt: string };
type TextOutput = { text: string };

/**
 * A streaming source task (append mode) that yields 5 text-delta chunks.
 */
class StreamSourceTask extends Task<TextInput, TextOutput> {
  public static override type = "StreamSourceTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string", default: "test" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: TextInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    const words = ["one", " ", "two", " ", "three"];
    for (const word of words) {
      if (context.signal.aborted) return;
      yield { type: "text-delta", port: "text", textDelta: word };
      await sleep(10);
    }
    yield { type: "finish", data: { text: "one two three" } };
  }

  override async execute(
    input: TextInput,
    context: IExecuteContext
  ): Promise<TextOutput | undefined> {
    return { text: "one two three" };
  }
}

/**
 * A streaming consumer task that consumes input and transforms.
 * Declared as streamable so the scheduler lets it start when deps are STREAMING.
 */
class StreamConsumerTask extends Task<TextInput, TextOutput> {
  public static override type = "StreamConsumerTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", default: "", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: any, context: IExecuteContext): Promise<TextOutput | undefined> {
    return { text: `processed: ${input.text || ""}` };
  }

  async *executeStream(
    input: any,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    yield {
      type: "text-delta",
      port: "text",
      textDelta: `processed: ${input.text || ""}`,
    };
    yield { type: "finish", data: { text: `processed: ${input.text || ""}` } };
  }
}

/**
 * A non-streaming consumer task that needs full input.
 */
class NonStreamConsumerTask extends Task<TextInput, TextOutput> {
  public static override type = "NonStreamConsumerTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", default: "" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: any, context: IExecuteContext): Promise<TextOutput | undefined> {
    return { text: `final: ${input.text || ""}` };
  }
}

/**
 * An append-mode streaming source that yields EMPTY finish data, matching
 * real provider behavior (e.g. OpenAI, Anthropic).  Without edge-level
 * accumulation the non-streaming downstream would receive undefined.
 */
class AppendEmptyFinishSource extends Task<TextInput, TextOutput> {
  public static override type = "AppendEmptyFinishSource";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string", default: "test" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: TextInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "edge " };
    yield { type: "text-delta", port: "text", textDelta: "accumulated" };
    // Empty finish – exactly what real providers emit in append mode
    yield { type: "finish", data: {} as TextOutput };
  }

  override async execute(
    input: TextInput,
    context: IExecuteContext
  ): Promise<TextOutput | undefined> {
    return { text: "edge accumulated" };
  }
}

/**
 * A replace-mode streaming source task.
 */
class ReplaceSourceTask extends Task<TextInput, TextOutput> {
  public static override type = "ReplaceSourceTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string", default: "test" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "replace" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: TextInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    yield { type: "snapshot", data: { text: "Hello" } };
    yield { type: "snapshot", data: { text: "Hello world" } };
    yield { type: "snapshot", data: { text: "Hello world!" } };
    yield { type: "finish", data: { text: "Hello world!" } };
  }

  override async execute(
    input: TextInput,
    context: IExecuteContext
  ): Promise<TextOutput | undefined> {
    return { text: "Hello world!" };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("TaskGraph Streaming", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let graph: TaskGraph;
  let runner: TaskGraphRunner;

  describe("Scheduler streaming readiness", () => {
    it("should mark streamable tasks as ready when dependencies are STREAMING", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ id: "source", defaults: { prompt: "test" } });
      const consumer = new StreamConsumerTask({ id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);

      // Track status transitions for both tasks
      const sourceStatuses: TaskStatus[] = [];
      const consumerStatuses: TaskStatus[] = [];

      source.on("status", (s) => sourceStatuses.push(s));
      consumer.on("status", (s) => consumerStatuses.push(s));

      await runner.runGraph({ prompt: "test" });

      // Source should have gone through STREAMING
      expect(sourceStatuses).toContain(TaskStatus.STREAMING);
      expect(sourceStatuses).toContain(TaskStatus.COMPLETED);

      // Consumer should have completed
      expect(consumerStatuses).toContain(TaskStatus.COMPLETED);
    });

    it("should NOT start non-streaming tasks when deps are only STREAMING", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ id: "source", defaults: { prompt: "test" } });
      const nonStreamConsumer = new NonStreamConsumerTask({ id: "non-stream" });

      graph.addTasks([source, nonStreamConsumer]);
      graph.addDataflow(new Dataflow("source", "text", "non-stream", "text"));

      runner = new TaskGraphRunner(graph);

      const nonStreamStartTimes: number[] = [];
      const sourceCompleteTimes: number[] = [];

      nonStreamConsumer.on("status", (s) => {
        if (s === TaskStatus.PROCESSING) {
          nonStreamStartTimes.push(Date.now());
        }
      });

      source.on("status", (s) => {
        if (s === TaskStatus.COMPLETED) {
          sourceCompleteTimes.push(Date.now());
        }
      });

      await runner.runGraph({ prompt: "test" });

      // Non-streaming consumer should have started AFTER source completed
      expect(sourceCompleteTimes.length).toBe(1);
      expect(nonStreamStartTimes.length).toBe(1);
      expect(nonStreamStartTimes[0]).toBeGreaterThanOrEqual(sourceCompleteTimes[0]);

      // Non-streaming consumer should have received the final output
      expect(nonStreamConsumer.status).toBe(TaskStatus.COMPLETED);
    });
  });

  describe("Streaming chain", () => {
    it("should execute StreamSourceTask -> StreamConsumerTask pipeline", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ id: "source", defaults: { prompt: "test" } });
      const consumer = new StreamConsumerTask({ id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      // Both tasks should complete
      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(consumer.status).toBe(TaskStatus.COMPLETED);

      // Consumer is a leaf, so we get its results
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("consumer");
    });
  });

  describe("Mixed chain (streaming + non-streaming downstream)", () => {
    it("should handle fan-out to both streaming and non-streaming consumers", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ id: "source", defaults: { prompt: "test" } });
      const streamConsumer = new StreamConsumerTask({ id: "stream-consumer" });
      const nonStreamConsumer = new NonStreamConsumerTask({ id: "non-stream-consumer" });

      graph.addTasks([source, streamConsumer, nonStreamConsumer]);
      graph.addDataflow(new Dataflow("source", "text", "stream-consumer", "text"));
      graph.addDataflow(new Dataflow("source", "text", "non-stream-consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      // All tasks should complete
      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(streamConsumer.status).toBe(TaskStatus.COMPLETED);
      expect(nonStreamConsumer.status).toBe(TaskStatus.COMPLETED);

      // Both consumers are leaves
      expect(results.length).toBe(2);
    });
  });

  describe("Replace chain", () => {
    it("should handle replace source -> non-streaming consumer", async () => {
      graph = new TaskGraph();

      const source = new ReplaceSourceTask({ id: "source", defaults: { prompt: "test" } });
      const consumer = new NonStreamConsumerTask({ id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      // Non-streaming task waits for full completion and gets final snapshot
      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(consumer.status).toBe(TaskStatus.COMPLETED);

      // Source should have the final snapshot in runOutputData
      expect(source.runOutputData.text).toBe("Hello world!");

      // Consumer should have received the final result
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("consumer");
      expect((results[0].data as any).text).toBe("final: Hello world!");
    });
  });

  describe("Stream events on dataflow edges", () => {
    it("should set stream on outgoing dataflow edges for streaming tasks", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ id: "source", defaults: { prompt: "test" } });
      const consumer = new StreamConsumerTask({ id: "consumer" });

      graph.addTasks([source, consumer]);
      const dataflow = new Dataflow("source", "text", "consumer", "text");
      graph.addDataflow(dataflow);

      runner = new TaskGraphRunner(graph);

      // Listen for streaming status on the dataflow
      let streamingStatusSeen = false;
      dataflow.on("streaming", () => {
        streamingStatusSeen = true;
      });

      await runner.runGraph({ prompt: "test" });

      // The dataflow should have seen streaming status
      expect(streamingStatusSeen).toBe(true);
    });
  });

  describe("Dataflow stream and reset", () => {
    it("should clear stream on dataflow reset", () => {
      const dataflow = new Dataflow("a", "out", "b", "in");
      const mockStream = new ReadableStream();
      dataflow.setStream(mockStream);
      expect(dataflow.getStream()).toBe(mockStream);

      dataflow.reset();
      expect(dataflow.getStream()).toBeUndefined();
      expect(dataflow.value).toBeUndefined();
      expect(dataflow.status).toBe(TaskStatus.PENDING);
    });

    it("should handle STREAMING status on dataflow", () => {
      const dataflow = new Dataflow("a", "out", "b", "in");
      const statuses: TaskStatus[] = [];
      dataflow.on("status", (s) => statuses.push(s));

      dataflow.setStatus(TaskStatus.STREAMING);

      expect(dataflow.status).toBe(TaskStatus.STREAMING);
      expect(statuses).toContain(TaskStatus.STREAMING);
    });
  });

  describe("Source-task streaming accumulation (graph-level)", () => {
    it("should materialise text-deltas for non-streaming downstream via source-task accumulation", async () => {
      graph = new TaskGraph();

      // AppendEmptyFinishSource emits text-deltas + empty finish {}.
      // The graph runner detects a non-streaming downstream and sets
      // shouldAccumulate=true, so the source task emits an enriched finish
      // event with the accumulated text.  The dataflow reads the finish event
      // and materialises the value without re-accumulating text-deltas itself.
      const source = new AppendEmptyFinishSource({ id: "source", defaults: { prompt: "test" } });
      const consumer = new NonStreamConsumerTask({ id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(consumer.status).toBe(TaskStatus.COMPLETED);

      // Consumer should have received the accumulated text via the enriched finish event
      expect(results.length).toBe(1);
      expect((results[0].data as any).text).toBe("final: edge accumulated");
    });

    it("should accumulate once and share via tee for fan-out (one streaming, one non-streaming)", async () => {
      graph = new TaskGraph();

      const source = new AppendEmptyFinishSource({ id: "source", defaults: { prompt: "test" } });
      const streamConsumer = new StreamConsumerTask({ id: "stream-c" });
      const nonStreamConsumer = new NonStreamConsumerTask({ id: "non-stream-c" });

      graph.addTasks([source, streamConsumer, nonStreamConsumer]);
      graph.addDataflow(new Dataflow("source", "text", "stream-c", "text"));
      graph.addDataflow(new Dataflow("source", "text", "non-stream-c", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(streamConsumer.status).toBe(TaskStatus.COMPLETED);
      expect(nonStreamConsumer.status).toBe(TaskStatus.COMPLETED);

      // The non-streaming consumer gets the accumulated value via the enriched finish
      const nonStreamResult = results.find((r) => r.id === "non-stream-c");
      expect(nonStreamResult).toBeDefined();
      expect((nonStreamResult!.data as any).text).toBe("final: edge accumulated");
    });

    it("should materialise replace-mode snapshots for non-streaming downstream", async () => {
      graph = new TaskGraph();

      const source = new ReplaceSourceTask({ id: "source", defaults: { prompt: "test" } });
      const consumer = new NonStreamConsumerTask({ id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      // Replace mode: the final snapshot is used
      expect((results[0].data as any).text).toBe("final: Hello world!");
    });
  });

  describe("Dataflow.awaitStreamValue", () => {
    it("should materialise value from enriched finish event (source task accumulates, not the edge)", async () => {
      // The source task emits an enriched finish event carrying the full accumulated text.
      // The dataflow just reads the finish event -- it does NOT re-accumulate text-deltas.
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "hello" });
          controller.enqueue({ type: "text-delta", port: "text", textDelta: " world" });
          // Enriched finish -- source task already accumulated the text-deltas
          controller.enqueue({ type: "finish", data: { text: "hello world" } });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // Finish data is used; text-deltas are ignored by the edge
      expect(dataflow.value).toBe("hello world");
      expect(dataflow.getStream()).toBeUndefined();
    });

    it("should use last snapshot for replace-mode events (snapshot takes priority over finish)", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "snapshot", data: { text: "partial" } });
          controller.enqueue({ type: "snapshot", data: { text: "complete" } });
          controller.enqueue({ type: "finish", data: { text: "complete" } });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // Last snapshot is used via setPortData, which extracts the port value
      expect(dataflow.value).toBe("complete");
    });

    it("should use finish event data when no snapshot is present", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          // text-deltas ignored; source task provides enriched finish
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "partial" });
          controller.enqueue({ type: "finish", data: { text: "full result" } });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // Finish data is used directly
      expect(dataflow.value).toBe("full result");
    });

    it("should use enriched finish for DATAFLOW_ALL_PORTS edges", async () => {
      // Source task with shouldAccumulate=true emits enriched finish.
      // The all-ports edge just reads the finish payload.
      const dataflow = new Dataflow("a", "*", "b", "*");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "abc" });
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "def" });
          // Enriched finish from source task
          controller.enqueue({ type: "finish", data: { text: "abcdef" } });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // all-ports: setPortData stores the whole finish payload as value
      expect(dataflow.value).toEqual({ text: "abcdef" });
    });

    it("should ignore text-delta events and leave value undefined when finish carries no data", async () => {
      // When shouldAccumulate=false on source, raw empty finish is emitted.
      // Edge sees no finish data and no snapshot, so value stays undefined.
      // (In practice this only happens when the downstream edge doesn't need data.)
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "ignored" });
          controller.enqueue({ type: "finish", data: {} as any });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // No snapshot, finish data is empty object → setPortData({}) → value = undefined for specific port
      expect(dataflow.value).toBeUndefined();
      expect(dataflow.getStream()).toBeUndefined();
    });

    it("should throw and set FAILED status on stream error events", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "partial" });
          controller.enqueue({ type: "error", error: new Error("upstream failure") });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await expect(dataflow.awaitStreamValue()).rejects.toThrow("upstream failure");
      expect(dataflow.status).toBe(TaskStatus.FAILED);
      expect(dataflow.error).toBeInstanceOf(Error);
    });

    it("should be a no-op when no stream is present", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");
      dataflow.value = "existing";

      await dataflow.awaitStreamValue();

      expect(dataflow.value).toBe("existing");
    });
  });

  describe("Abort during streaming graph", () => {
    it("should abort streaming tasks when graph is aborted", async () => {
      graph = new TaskGraph();

      // Use a slow streaming source
      const source = new StreamSourceTask({ id: "source", defaults: { prompt: "test" } });
      const consumer = new NonStreamConsumerTask({ id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);

      const runPromise = runner.runGraph({ prompt: "test" });

      // Give it a moment to start, then abort
      await sleep(20);
      runner.abort();

      try {
        await runPromise;
      } catch (err: any) {
        // Expected abort error
        expect(err.message).toContain("abort");
      }
    });
  });

  describe("Port-level streaming in graph", () => {
    it("should use x-stream annotation to determine streaming in graph execution", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ id: "source", defaults: { prompt: "test" } });
      const consumer = new NonStreamConsumerTask({ id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      expect(results.length).toBeGreaterThan(0);
      const consumerResult = results.find((r) => r.id === "consumer");
      expect(consumerResult).toBeDefined();
      expect((consumerResult!.data as any).text).toContain("final:");
    });

    it("should detect output stream mode from schema", () => {
      expect(getOutputStreamMode(StreamSourceTask.outputSchema())).toBe("append");
      expect(getOutputStreamMode(ReplaceSourceTask.outputSchema())).toBe("replace");
      expect(getOutputStreamMode(NonStreamConsumerTask.outputSchema())).toBe("none");
    });
  });

  // ============================================================================
  // GraphAsTask.executeStream() race-condition regression
  // ============================================================================

  /**
   * A streaming task that emits many chunks without any sleep, maximising the
   * chance that notifications arrive while the outer generator is still
   * actively draining the queue (rather than waiting on notifyPromise).
   * This exercises both the "producer fires before the first await" path and
   * the "producer fires between waits" (stale-resolver) path.
   */
  class RapidStreamTask extends Task<TextInput, TextOutput> {
    public static override type = "RapidStreamTask";
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
        additionalProperties: false,
      } as const satisfies DataPortSchema;
    }

    async *executeStream(
      _input: TextInput,
      _context: IExecuteContext
    ): AsyncIterable<StreamEvent<TextOutput>> {
      // Emit 8 chunks with no sleep to maximise batching / notify-before-wait races.
      for (let i = 1; i <= 8; i++) {
        yield { type: "text-delta", port: "text", textDelta: `chunk${i}` };
      }
      yield { type: "finish", data: { text: "chunk1chunk2chunk3chunk4chunk5chunk6chunk7chunk8" } };
    }

    override async execute(
      _input: TextInput,
      _context: IExecuteContext
    ): Promise<TextOutput | undefined> {
      return { text: "chunk1chunk2chunk3chunk4chunk5chunk6chunk7chunk8" };
    }
  }

  /**
   * A task whose execute() always rejects, used to verify that a subgraph
   * failure unblocks and propagates through GraphAsTask.executeStream().
   */
  class AlwaysFailTask extends Task<TextInput, TextOutput> {
    public static override type = "AlwaysFailTask";
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
        properties: { text: { type: "string" } },
        additionalProperties: false,
      } as const satisfies DataPortSchema;
    }

    override async execute(
      _input: TextInput,
      _context: IExecuteContext
    ): Promise<TextOutput | undefined> {
      throw new Error("subgraph-failure");
    }
  }

  describe("GraphAsTask.executeStream() race-condition regression", () => {
    it("should forward all chunks from a rapid-fire inner streaming task", async () => {
      const subGraph = new TaskGraph();
      const source = new RapidStreamTask({ id: "rapid-src", defaults: { prompt: "test" } });
      subGraph.addTask(source);

      // Embed the subgraph inside a GraphAsTask so executeStream() is exercised.
      const gat = new GraphAsTask({ id: "gat", subGraph });

      // Drive the GraphAsTask via an outer TaskGraphRunner.
      const outerGraph = new TaskGraph();
      outerGraph.addTask(gat);
      const outerRunner = new TaskGraphRunner(outerGraph);

      // Collect every stream_chunk event emitted by the GraphAsTask.
      const chunks: StreamEvent[] = [];
      gat.on("stream_chunk", (ev) => chunks.push(ev));

      await outerRunner.runGraph({ prompt: "test" });

      expect(gat.status).toBe(TaskStatus.COMPLETED);

      // There should be exactly 8 text-delta events plus the finish event.
      const deltas = chunks.filter((e) => e.type === "text-delta");
      expect(deltas).toHaveLength(8);
      const finish = chunks.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
    });

    it("should propagate a subgraph rejection out of executeStream()", async () => {
      const subGraph = new TaskGraph();
      const failing = new AlwaysFailTask({ id: "fail-src", defaults: { prompt: "test" } });
      subGraph.addTask(failing);

      const gat = new GraphAsTask({ id: "gat-err", subGraph });
      const outerGraph = new TaskGraph();
      outerGraph.addTask(gat);
      const outerRunner = new TaskGraphRunner(outerGraph);

      // The runner should reject (or the GraphAsTask should end up FAILED).
      try {
        await outerRunner.runGraph({ prompt: "test" });
      } catch {
        // Rejection is one acceptable outcome.
      }

      // Regardless of how errors surface, the subgraph task must not be
      // left spinning (PENDING/PROCESSING) — it should reach a terminal state.
      expect([TaskStatus.FAILED, TaskStatus.COMPLETED]).toContain(failing.status);
    });
  });
});
