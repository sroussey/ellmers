/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, StreamEvent, TaskIdType } from "@workglow/task-graph";
import { Dataflow, Task, TaskGraph, TaskGraphRunner } from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

// ============================================================================
// Test Tasks
// ============================================================================

type TextInput = { prompt: string };
type TextOutput = { text: string };

class StreamSourceTask extends Task<TextInput, TextOutput> {
  public static override type = "StreamSourceTask_Events";
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
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "hello" };
    await sleep(5);
    yield { type: "text-delta", port: "text", textDelta: " world" };
    yield { type: "finish", data: { text: "hello world" } };
  }

  override async execute(_input: TextInput): Promise<TextOutput | undefined> {
    return { text: "hello world" };
  }
}

class NonStreamTask extends Task<{ text: string }, TextOutput> {
  public static override type = "NonStreamTask_Events";
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

  override async execute(input: any): Promise<TextOutput | undefined> {
    return { text: `done: ${input.text || ""}` };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("TaskGraph Stream Events", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("task_stream_start / task_stream_chunk / task_stream_end on TaskGraph", () => {
    it("should emit task_stream_start when a streaming task begins", async () => {
      const graph = new TaskGraph();
      const source = new StreamSourceTask({ id: "src", defaults: { prompt: "hi" } });
      const sink = new NonStreamTask({ id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("src", "text", "sink", "text"));

      const runner = new TaskGraphRunner(graph);

      const startIds: TaskIdType[] = [];
      graph.on("task_stream_start", (taskId) => {
        startIds.push(taskId);
      });

      await runner.runGraph({ prompt: "hi" });

      expect(startIds).toContain("src");
      expect(startIds.length).toBe(1);
    });

    it("should emit task_stream_chunk for each chunk", async () => {
      const graph = new TaskGraph();
      const source = new StreamSourceTask({ id: "src", defaults: { prompt: "hi" } });
      const sink = new NonStreamTask({ id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("src", "text", "sink", "text"));

      const runner = new TaskGraphRunner(graph);

      const chunks: { taskId: TaskIdType; event: StreamEvent }[] = [];
      graph.on("task_stream_chunk", (taskId, event) => {
        chunks.push({ taskId, event });
      });

      await runner.runGraph({ prompt: "hi" });

      // StreamSourceTask yields: text-delta "hello", text-delta " world", finish
      const textDeltas = chunks.filter((c) => c.event.type === "text-delta");
      expect(textDeltas.length).toBe(2);
      expect(textDeltas[0].taskId).toBe("src");
      expect(textDeltas[0].event.type).toBe("text-delta");
      expect((textDeltas[0].event as any).textDelta).toBe("hello");
      expect((textDeltas[1].event as any).textDelta).toBe(" world");
    });

    it("should emit task_stream_end when streaming finishes", async () => {
      const graph = new TaskGraph();
      const source = new StreamSourceTask({ id: "src", defaults: { prompt: "hi" } });
      const sink = new NonStreamTask({ id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("src", "text", "sink", "text"));

      const runner = new TaskGraphRunner(graph);

      const ends: { taskId: TaskIdType; output: Record<string, any> }[] = [];
      graph.on("task_stream_end", (taskId, output) => {
        ends.push({ taskId, output });
      });

      await runner.runGraph({ prompt: "hi" });

      expect(ends.length).toBe(1);
      expect(ends[0].taskId).toBe("src");
      expect(ends[0].output).toEqual({ text: "hello world" });
    });

    it("should not emit streaming events for non-streaming tasks", async () => {
      const graph = new TaskGraph();
      const source = new StreamSourceTask({ id: "src", defaults: { prompt: "hi" } });
      const sink = new NonStreamTask({ id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("src", "text", "sink", "text"));

      const runner = new TaskGraphRunner(graph);

      const allStartIds: TaskIdType[] = [];
      graph.on("task_stream_start", (taskId) => allStartIds.push(taskId));

      await runner.runGraph({ prompt: "hi" });

      // Only the streaming source should trigger stream events, not the sink
      expect(allStartIds).not.toContain("sink");
    });
  });

  describe("subscribeToTaskStreaming()", () => {
    it("should deliver events through the subscription API", async () => {
      const graph = new TaskGraph();
      const source = new StreamSourceTask({ id: "src", defaults: { prompt: "hi" } });
      const sink = new NonStreamTask({ id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("src", "text", "sink", "text"));

      const runner = new TaskGraphRunner(graph);

      const starts: TaskIdType[] = [];
      const chunks: StreamEvent[] = [];
      const ends: TaskIdType[] = [];

      const unsub = graph.subscribeToTaskStreaming({
        onStreamStart: (taskId) => starts.push(taskId),
        onStreamChunk: (_taskId, event) => chunks.push(event),
        onStreamEnd: (taskId) => ends.push(taskId),
      });

      await runner.runGraph({ prompt: "hi" });

      expect(starts).toContain("src");
      expect(chunks.length).toBeGreaterThan(0);
      expect(ends).toContain("src");

      unsub();
    });

    it("should stop receiving events after unsubscribe", async () => {
      const graph = new TaskGraph();
      const source = new StreamSourceTask({ id: "src", defaults: { prompt: "hi" } });

      graph.addTasks([source]);

      const runner = new TaskGraphRunner(graph);

      const starts: TaskIdType[] = [];
      const unsub = graph.subscribeToTaskStreaming({
        onStreamStart: (taskId) => starts.push(taskId),
      });

      // Unsubscribe before running
      unsub();

      await runner.runGraph({ prompt: "hi" });

      expect(starts.length).toBe(0);
    });

    it("should allow partial callbacks (only onStreamChunk)", async () => {
      const graph = new TaskGraph();
      const source = new StreamSourceTask({ id: "src", defaults: { prompt: "hi" } });

      graph.addTasks([source]);

      const runner = new TaskGraphRunner(graph);

      const chunks: StreamEvent[] = [];
      const unsub = graph.subscribeToTaskStreaming({
        onStreamChunk: (_taskId, event) => chunks.push(event),
      });

      await runner.runGraph({ prompt: "hi" });

      expect(chunks.length).toBeGreaterThan(0);

      unsub();
    });
  });
});
