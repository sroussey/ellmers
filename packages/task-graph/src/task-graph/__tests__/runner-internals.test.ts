/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  EdgeMaterializer,
  RunContext,
  RunScheduler,
  StreamPump,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskRegistry,
  TaskStatus,
  type CachePolicy,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Tiny test tasks — kept local so they don't pollute the shared TestTasks set.
// ---------------------------------------------------------------------------

class RunnerInternalsSourceTask extends Task<{ value: string }, { value: string }> {
  public static override readonly type = "RunnerInternals_Source";
  public static override readonly category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override readonly title = "Source";
  public static override readonly description = "Source";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { value: string }): Promise<{ value: string }> {
    return { value: input.value };
  }
}

class RunnerInternalsSinkTask extends Task<{ value: string }, { result: string }> {
  public static override readonly type = "RunnerInternals_Sink";
  public static override readonly category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override readonly title = "Sink";
  public static override readonly description = "Sink";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { value: string }): Promise<{ result: string }> {
    return { result: input.value };
  }
}

beforeEach(() => {
  TaskRegistry.registerTask(RunnerInternalsSourceTask);
  TaskRegistry.registerTask(RunnerInternalsSinkTask);
});

// ---------------------------------------------------------------------------
// EdgeMaterializer
// ---------------------------------------------------------------------------

describe("EdgeMaterializer", () => {
  it("copyInputFromEdgesToNode reads from one upstream edge", async () => {
    const graph = new TaskGraph();
    const a = new RunnerInternalsSourceTask({ id: "a" });
    const b = new RunnerInternalsSinkTask({ id: "b" });
    graph.addTask(a);
    graph.addTask(b);
    graph.addDataflow(new Dataflow(a.id, "value", b.id, "value"));

    const runner = new TaskGraphRunner(graph);
    const em = new EdgeMaterializer(graph, runner);

    // Push a's output to its outgoing edge, then materialize b's input.
    await em.pushOutputFromNodeToEdges(a, { value: "hello" });
    em.copyInputFromEdgesToNode(b);

    expect(b.runInputData.value).toBe("hello");
  });

  it("pushErrorOutputToEdges sets error edge COMPLETED + sibling edge DISABLED", () => {
    const graph = new TaskGraph();
    const a = new RunnerInternalsSourceTask({ id: "a" });
    const errSink = new RunnerInternalsSinkTask({ id: "err" });
    const normalSink = new RunnerInternalsSinkTask({ id: "ok" });
    graph.addTask(a);
    graph.addTask(errSink);
    graph.addTask(normalSink);

    graph.addDataflow(new Dataflow(a.id, "[error]", errSink.id, "value"));
    graph.addDataflow(new Dataflow(a.id, "value", normalSink.id, "value"));

    const runner = new TaskGraphRunner(graph);
    const em = new EdgeMaterializer(graph, runner);
    em.pushErrorOutputToEdges(a);

    const errDf = graph.getDataflows().find((d) => d.sourceTaskPortId === "[error]")!;
    const normalDf = graph.getDataflows().find((d) => d.sourceTaskPortId === "value")!;
    expect(errDf.status).toBe(TaskStatus.COMPLETED);
    expect(normalDf.status).toBe(TaskStatus.DISABLED);
  });
});

// ---------------------------------------------------------------------------
// RunScheduler
// ---------------------------------------------------------------------------

describe("RunScheduler", () => {
  it("propagateDisabledStatus cascades through a 3-node chain", () => {
    const graph = new TaskGraph();
    const a = new RunnerInternalsSourceTask({ id: "a" });
    const b = new RunnerInternalsSinkTask({ id: "b" });
    const c = new RunnerInternalsSinkTask({ id: "c" });
    graph.addTask(a);
    graph.addTask(b);
    graph.addTask(c);
    const dfAB = new Dataflow(a.id, "value", b.id, "value");
    graph.addDataflow(dfAB);
    graph.addDataflow(new Dataflow(b.id, "result", c.id, "value"));

    // Simulate `a` being disabled: status flipped + outgoing edge marked DISABLED.
    // (In production this is done by pushStatusFromNodeToEdges; here we set it
    // directly so the test is hermetic to that helper.)
    a.status = TaskStatus.DISABLED;
    dfAB.setStatus(TaskStatus.DISABLED);

    const runner = new TaskGraphRunner(graph);
    const ctx = new RunContext();
    // processScheduler is protected; bracket access keeps the seam testable.
    const rs = new RunScheduler(graph, (runner as any).processScheduler, runner);
    rs.propagateDisabledStatus(ctx);

    expect(b.status).toBe(TaskStatus.DISABLED);
    expect(c.status).toBe(TaskStatus.DISABLED);
  });

  it("handleProgress averages across two contributing tasks", async () => {
    const graph = new TaskGraph();
    const a = new RunnerInternalsSourceTask({ id: "a" });
    const b = new RunnerInternalsSinkTask({ id: "b" });
    graph.addTask(a);
    graph.addTask(b);

    a.progress = 60;
    b.progress = 40;

    const runner = new TaskGraphRunner(graph);
    const ctx = new RunContext();
    const rs = new RunScheduler(graph, (runner as any).processScheduler, runner);

    let captured: number | undefined;
    graph.subscribe("graph_progress", (p) => {
      captured = p;
    });

    await rs.handleProgress(ctx, a, undefined);
    expect(captured).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// StreamPump
// ---------------------------------------------------------------------------

describe("StreamPump", () => {
  it("taskNeedsAccumulation returns true when output cache is active", () => {
    const graph = new TaskGraph();
    const a = new RunnerInternalsSourceTask({ id: "a" });
    const b = new RunnerInternalsSinkTask({ id: "b" });
    graph.addTask(a);
    graph.addTask(b);
    graph.addDataflow(new Dataflow(a.id, "value", b.id, "value"));

    const runner = new TaskGraphRunner(graph);
    const em = new EdgeMaterializer(graph, runner);
    const sp = new StreamPump(graph, (runner as any).processScheduler, em);

    // Bracket access bypasses TS visibility — taskNeedsAccumulation is `private`.
    // Two-arg branch: when outputCache is truthy, accumulation is required regardless of edges.
    const fakeOutputCache = {} as any;
    expect((sp as any).taskNeedsAccumulation(a, fakeOutputCache, false)).toBe(true);

    // Inverse smoke: with a non-streaming chain and no outputCache, no accumulation is needed.
    expect((sp as any).taskNeedsAccumulation(a, undefined, false)).toBe(false);
  });

  it("cleans up listeners when the reader cancels mid-stream", async () => {
    const graph = new TaskGraph();
    const a = new RunnerInternalsSourceTask({ id: "a" });
    const b = new RunnerInternalsSinkTask({ id: "b" });
    graph.addTask(a);
    graph.addTask(b);
    // One edge — `createStreamFromTaskEvents` requires at least one
    // dataflow group to be exercised via `pushStreamToEdges`. We invoke the
    // private method directly via bracket access so the test exercises the
    // cancel handler without needing a fully-running graph.
    graph.addDataflow(new Dataflow(a.id, "value", b.id, "value"));

    const runner = new TaskGraphRunner(graph);
    const em = new EdgeMaterializer(graph, runner);
    const sp = new StreamPump(graph, (runner as any).processScheduler, em);

    const edges = graph.getTargetDataflows(a.id);
    const stream: ReadableStream = (sp as any).createStreamFromTaskEvents(a, "value", edges);

    // Sanity: the start() callback wires up listeners synchronously when the
    // stream is constructed (ReadableStream calls start eagerly). But pull is
    // lazy in some implementations — fetch a reader to ensure the start hook
    // ran before we assert.
    const reader = stream.getReader();

    // Emit one chunk so the consumer sees at least one event before cancel.
    a.emit("stream_chunk", { type: "text-delta", port: "value", textDelta: "hi" } as any);
    const first = await reader.read();
    expect(first.done).toBe(false);

    expect(a.events.listenerCount("stream_chunk")).toBeGreaterThanOrEqual(1);
    expect(a.events.listenerCount("stream_end")).toBeGreaterThanOrEqual(1);
    expect(a.events.listenerCount("status")).toBeGreaterThanOrEqual(1);

    await reader.cancel();

    // After cancellation, the cleanup handler must have detached every
    // listener createStreamFromTaskEvents installed.
    expect(a.events.listenerCount("stream_chunk")).toBe(0);
    expect(a.events.listenerCount("stream_end")).toBe(0);
    expect(a.events.listenerCount("status")).toBe(0);
  });

  it("prepareStreamingInputs tees upstream stream into task.runner.inputStreams", () => {
    const graph = new TaskGraph();
    const a = new RunnerInternalsSourceTask({ id: "a" });
    const b = new RunnerInternalsSinkTask({ id: "b" });
    graph.addTask(a);
    graph.addTask(b);
    graph.addDataflow(new Dataflow(a.id, "value", b.id, "value"));
    const df = graph.getDataflows()[0];

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", text: "hi" } as any);
        controller.close();
      },
    });
    df.setStream(stream as any);

    const runner = new TaskGraphRunner(graph);
    const em = new EdgeMaterializer(graph, runner);
    const sp = new StreamPump(graph, (runner as any).processScheduler, em);
    sp.prepareStreamingInputs(b);

    expect(b.runner.inputStreams).toBeDefined();
    expect(b.runner.inputStreams!.has("value")).toBe(true);
    expect(df.stream).toBeDefined();
    expect(df.stream).not.toBe(stream); // tee replaced the original
  });
});
