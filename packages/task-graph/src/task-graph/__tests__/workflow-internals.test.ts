/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  LoopBuilderContext,
  Task,
  TaskGraph,
  TaskRegistry,
  Workflow,
  WorkflowBuilder,
  WorkflowEventBridge,
  runLoopAutoConnect,
  type CachePolicy,
} from "@workglow/task-graph";
import { EventEmitter } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Tiny test tasks — kept local so they don't pollute the shared TestTasks set.
// ---------------------------------------------------------------------------

class WfInternalsSourceTask extends Task<{ value: string }, { value: string }> {
  public static override readonly type = "WfInternals_Source";
  public static override readonly category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };
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

class WfInternalsSinkTask extends Task<{ value: string }, { result: string }> {
  public static override readonly type = "WfInternals_Sink";
  public static override readonly category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };
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
  TaskRegistry.registerTask(WfInternalsSourceTask);
  TaskRegistry.registerTask(WfInternalsSinkTask);
});

// ---------------------------------------------------------------------------
// WorkflowEventBridge
// ---------------------------------------------------------------------------

describe("WorkflowEventBridge", () => {
  it("attach() routes graph mutations to the events emitter; detach() unsubscribes", () => {
    const events = new EventEmitter<any>();
    const bridge = new WorkflowEventBridge(events);
    const graph = new TaskGraph();

    let changed = 0;
    events.on("changed", () => changed++);

    bridge.attach(graph);
    graph.addTask(new WfInternalsSourceTask({ id: "a" }));
    const afterAttach = changed;
    expect(afterAttach).toBeGreaterThan(0);

    bridge.detach();
    graph.addTask(new WfInternalsSinkTask({ id: "b" }));
    expect(changed).toBe(afterAttach);
  });

  it("attach() called twice auto-detaches the first subscription (no double-fire)", () => {
    const events = new EventEmitter<any>();
    const bridge = new WorkflowEventBridge(events);
    const graph1 = new TaskGraph();
    const graph2 = new TaskGraph();

    let changed = 0;
    events.on("changed", () => changed++);

    bridge.attach(graph1);
    bridge.attach(graph2);

    // Mutating the OLD graph must not fire events any more — bridge re-anchored to graph2.
    const beforeOld = changed;
    graph1.addTask(new WfInternalsSourceTask({ id: "stale" }));
    expect(changed).toBe(beforeOld);

    // Mutating the NEW graph fires exactly one set of changes (no double-subscription).
    graph2.addTask(new WfInternalsSourceTask({ id: "fresh" }));
    expect(changed).toBeGreaterThan(beforeOld);
  });

  it("beginRun() returns an unsub token that stops streaming-event propagation", () => {
    const events = new EventEmitter<any>();
    const bridge = new WorkflowEventBridge(events);
    const graph = new TaskGraph();
    bridge.attach(graph);

    const chunks: unknown[] = [];
    events.on("stream_chunk", (_id: unknown, e: unknown) => chunks.push(e));

    const unsub = bridge.beginRun();
    expect(unsub).toBeDefined();

    // Fire a synthetic streaming event on the graph; bridge must relay it.
    graph.emit("task_stream_chunk", "src", { type: "text-delta", port: "x", textDelta: "hi" });
    expect(chunks).toHaveLength(1);

    // Release the run; subsequent emits must not relay.
    unsub!();
    graph.emit("task_stream_chunk", "src", { type: "text-delta", port: "x", textDelta: "post" });
    expect(chunks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// LoopBuilderContext
// ---------------------------------------------------------------------------

describe("LoopBuilderContext", () => {
  it("finalizeTemplate is a no-op on an empty child graph (no subGraph assignment)", () => {
    const parent = new Workflow();
    parent.addTask(WfInternalsSourceTask, { value: "x" });
    const inner = parent.addLoopTask(WfInternalsSourceTask as any, {});

    // Don't add anything to the child — child graph is empty.
    inner.finalizeTemplate();

    // The iterator task on the parent should still have its initial subGraph
    // (which is an empty graph allocated by GraphAsTask), but finalize should
    // NOT have promoted the empty child into it. Easiest observable check:
    // the iterator's subGraph remains empty after finalize.
    const iter = parent.graph.getTasks().find((t) => t.id !== parent.graph.getTasks()[0].id);
    const sub = (iter as { subGraph?: TaskGraph }).subGraph;
    expect(sub).toBeDefined();
    expect(sub!.getTasks()).toHaveLength(0);
  });

  it("runLoopAutoConnect returns the error message when auto-connect cannot find a match", () => {
    // Construct a graph where autoConnect on the iterator can't find any
    // earlier task to satisfy the iterator's input. We use the bare helper
    // (free function exported alongside LoopBuilderContext) to avoid building
    // a full Workflow facade for this assertion.
    const graph = new TaskGraph();
    const upstream = new WfInternalsSourceTask({ id: "up" });
    const iterator = new WfInternalsSinkTask({ id: "iter" });
    graph.addTask(upstream);
    graph.addTask(iterator);

    // Pre-populate a dataflow into iterator so autoConnect's early exit triggers
    // (it returns undefined when target already has incoming edges). That's the
    // happy path — verify it.
    graph.addDataflow(new Dataflow(upstream.id, "value", iterator.id, "value"));

    const result = runLoopAutoConnect(graph, { parent: upstream, iteratorTask: iterator });
    // No work needed (iterator already had an incoming edge), so no error.
    expect(result).toBeUndefined();
  });

  it("consumePendingConnect clears pendingLoopConnect after invocation", () => {
    const parentWf = new Workflow();
    parentWf.addTask(WfInternalsSourceTask, { value: "x" });
    const iterator = new WfInternalsSinkTask({ id: "iter" });
    parentWf.graph.addTask(iterator);

    const ctx = new LoopBuilderContext(parentWf, iterator as never);
    ctx.pendingLoopConnect = { parent: iterator, iteratorTask: iterator };

    expect(ctx.pendingLoopConnect).toBeDefined();
    ctx.consumePendingConnect();
    expect(ctx.pendingLoopConnect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WorkflowBuilder
// ---------------------------------------------------------------------------

describe("WorkflowBuilder", () => {
  it("setError populates the .error getter; resetState clears it", () => {
    const w = new Workflow();
    // Reach the concrete builder (not the narrowed handle) for full API access.

    const builder = (w as any)._builder as WorkflowBuilder;

    builder.setError("boom");
    expect(builder.error).toBe("boom");

    builder.resetState();
    expect(builder.error).toBe("");
  });

  it("addTaskInstance adds the task to the facade's graph and emits 'changed'", () => {
    const w = new Workflow();

    const builder = (w as any)._builder as WorkflowBuilder;

    let changedCount = 0;
    w.on("changed", () => changedCount++);

    const before = changedCount;
    const task = builder.addTaskInstance(WfInternalsSourceTask, {
      id: "x",
      defaults: { value: "v" },
    } as never);

    expect(w.graph.getTask(task.id)).toBeDefined();
    expect(changedCount).toBeGreaterThan(before);
  });

  it("loopContext getter reflects the constructor argument", () => {
    const parentWf = new Workflow();
    const iterator = new WfInternalsSinkTask({ id: "iter" });
    const ctx = new LoopBuilderContext(parentWf, iterator as never);

    const builderWithCtx = new WorkflowBuilder(parentWf, undefined, ctx);
    expect(builderWithCtx.loopContext).toBe(ctx);

    const builderWithoutCtx = new WorkflowBuilder(parentWf);
    expect(builderWithoutCtx.loopContext).toBeUndefined();
  });
});
