/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, MapTask, StreamEvent } from "@workglow/task-graph";
import {
  bridgeSubGraphTaskEvents,
  Dataflow,
  FallbackTask,
  GraphAsTask,
  Task,
  TaskGraph,
  TaskRegistry,
  WhileTask,
  Workflow,
} from "@workglow/task-graph";
import type { ILogger } from "@workglow/util";
import { NullLogger, setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

class TCEAddOne extends Task<{ value: number }, { value: number }> {
  static override readonly type = "TCEAddOne";
  static override readonly category = "Test";
  static override title = "Add one";
  static override description = "Adds one to value";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { value: number }): Promise<{ value: number }> {
    return { value: (input.value ?? 0) + 1 };
  }
}
TaskRegistry.registerTask(TCEAddOne as never);

class TCEFails extends Task<{ value: number }, { value: number }> {
  static override readonly type = "TCEFails";
  static override readonly category = "Test";
  static override title = "Fails";
  static override description = "Always throws";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(): Promise<{ value: number }> {
    throw new Error("boom");
  }
}
TaskRegistry.registerTask(TCEFails as never);

// Permissive child: While injects `_iterationIndex`, so the body must allow
// additional properties.
class TCEPassthrough extends Task<{ value: number }, { value: number }> {
  static override readonly type = "TCEPassthrough";
  static override readonly category = "Test";
  static override title = "Passthrough add one";
  static override description = "Adds one, permissive input";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { value: number }): Promise<{ value: number }> {
    return { value: (input.value ?? 0) + 1 };
  }
}
TaskRegistry.registerTask(TCEPassthrough as never);

// Reports progress DURING execution (while PROCESSING) so it produces a
// non-terminal task_progress event (the terminal 100% tick is not emitted).
class TCEProgress extends Task<{ value: number }, { value: number }> {
  static override readonly type = "TCEProgress";
  static override readonly category = "Test";
  static override title = "Reports progress";
  static override description = "Reports mid-run progress";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(
    input: { value: number },
    ctx: IExecuteContext
  ): Promise<{ value: number }> {
    ctx.updateProgress(50, "halfway");
    return { value: (input.value ?? 0) + 1 };
  }
}
TaskRegistry.registerTask(TCEProgress as never);

class TCEStream extends Task<{ value: number }, { text: string }> {
  static override readonly type = "TCEStream";
  static override readonly category = "Test";
  static override title = "Stream";
  static override description = "Streams text";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<{ text: string }>> {
    yield { type: "text-delta", port: "text", textDelta: "hi" };
    yield { type: "finish", data: { text: "hi" } };
  }
  override async execute(): Promise<{ text: string }> {
    return { text: "hi" };
  }
}
TaskRegistry.registerTask(TCEStream as never);

// Map-iterable: doubles a single `item`. Used to verify that MapTask iterations
// (which run cloned subgraphs) bubble their inner task events to the top graph.
class TCEMapItem extends Task<{ item: number }, { processed: number }> {
  static override readonly type = "TCEMapItem";
  static override readonly category = "Test";
  static override title = "Map item double";
  static override description = "Doubles a single item";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { item: { type: "number" } },
      required: ["item"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { processed: { type: "number" } },
      required: ["processed"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { item: number }): Promise<{ processed: number }> {
    return { processed: input.item * 2 };
  }
}
TaskRegistry.registerTask(TCEMapItem as never);

describe("task_complete graph event", () => {
  it("emits task_complete for every completed task with its output", async () => {
    const graph = new TaskGraph();
    graph.addTask(new TCEAddOne({ id: "a" }));
    graph.addTask(new TCEAddOne({ id: "b" }));
    graph.addDataflow(new Dataflow("a", "value", "b", "value"));

    const seen: Array<{ taskId: unknown; output: unknown }> = [];
    const unsub = graph.subscribe("task_complete", (taskId, output) => {
      seen.push({ taskId, output });
    });

    await graph.run({ value: 10 });
    unsub();

    const ids = seen.map((e) => String(e.taskId)).sort();
    expect(ids).toEqual(["a", "b"]);
    const byId = new Map(seen.map((e) => [String(e.taskId), e.output as { value: number }]));
    expect(byId.get("a")).toEqual({ value: 11 });
    expect(byId.get("b")).toEqual({ value: 12 });
  });

  it("does not emit task_complete for a failed task", async () => {
    const graph = new TaskGraph();
    graph.addTask(new TCEAddOne({ id: "ok" }));
    graph.addTask(new TCEFails({ id: "bad" }));

    const seen: string[] = [];
    const unsub = graph.subscribe("task_complete", (taskId) => {
      seen.push(String(taskId));
    });

    await graph.run({ value: 1 }).catch(() => {});
    unsub();

    expect(seen).toContain("ok");
    expect(seen).not.toContain("bad");
  });

  it("bubbles task_complete from subgraph children up to the top-level graph", async () => {
    const subGraph = new TaskGraph();
    subGraph.addTask(new TCEAddOne({ id: "inner" }));
    const group = new GraphAsTask({ id: "group", subGraph });

    const top = new TaskGraph();
    top.addTask(group);

    const seen: string[] = [];
    const unsub = top.subscribe("task_complete", (taskId) => {
      seen.push(String(taskId));
    });

    await top.run({ value: 5 });
    unsub();

    // The compound node itself AND its inner child both surface on the top graph.
    expect(seen).toContain("group");
    expect(seen).toContain("inner");
  });

  it("bubbles task_progress from subgraph children to the top-level graph", async () => {
    const subGraph = new TaskGraph();
    subGraph.addTask(new TCEProgress({ id: "pinner" }));
    const group = new GraphAsTask({ id: "pgroup", subGraph });

    const top = new TaskGraph();
    top.addTask(group);

    const seen: Array<{ id: string; progress: number | undefined }> = [];
    const unsub = top.subscribe("task_progress", (taskId, progress) => {
      seen.push({ id: String(taskId), progress });
    });

    await top.run({ value: 5 });
    unsub();

    // The inner task's mid-run progress (50) bridges up; its terminal 100% tick
    // (fired after the task is COMPLETED) is NOT emitted as task_progress.
    expect(seen).toContainEqual({ id: "pinner", progress: 50 });
    expect(seen.filter((e) => e.id === "pinner").every((e) => e.progress !== 100)).toBe(true);
  });

  it("bubbles task_complete from a streaming group's children (executeStream path)", async () => {
    const subGraph = new TaskGraph();
    subGraph.addTask(new TCEStream({ id: "sinner" }));
    // A streaming ending node makes the group streamable -> executeStream path.
    const group = new GraphAsTask({ id: "sgroup", subGraph });

    const top = new TaskGraph();
    top.addTask(group);

    const seen: string[] = [];
    const unsub = top.subscribe("task_complete", (taskId) => {
      seen.push(String(taskId));
    });

    await top.run({ value: 5 });
    unsub();

    expect(seen).toContain("sgroup");
    expect(seen).toContain("sinner");
  });

  it("bubbles task_complete from a While loop's children", async () => {
    const body = new TCEPassthrough({ id: "wbody" });
    let iters = 0;
    const whileTask = new WhileTask({
      id: "wgroup",
      maxIterations: 3,
      condition: () => iters++ < 1,
    });
    const subGraph = new TaskGraph();
    subGraph.addTask(body);
    whileTask.subGraph = subGraph;

    const top = new TaskGraph();
    top.addTask(whileTask);

    const seen: string[] = [];
    const unsub = top.subscribe("task_complete", (taskId) => seen.push(String(taskId)));
    await top.run({ value: 5 });
    unsub();

    expect(seen).toContain("wbody");
  });

  it("bubbles task_complete from a Fallback (data mode) group's children", async () => {
    const child = new TCEPassthrough({ id: "fbody" });
    const fallback = new FallbackTask({ id: "fgroup", fallbackMode: "data", alternatives: [{}] });
    const subGraph = new TaskGraph();
    subGraph.addTask(child);
    fallback.subGraph = subGraph;

    const top = new TaskGraph();
    top.addTask(fallback);

    const seen: string[] = [];
    const unsub = top.subscribe("task_complete", (taskId) => seen.push(String(taskId)));
    await top.run({ value: 5 });
    unsub();

    expect(seen).toContain("fbody");
  });

  it("bubbles task_complete from a Map loop's per-iteration children", async () => {
    const workflow = new Workflow();
    workflow.map({ maxIterations: "unbounded" }).addTask(TCEMapItem).endMap();
    const mapTask = workflow.graph.getTasks()[0] as MapTask;

    const innerOutputs: number[] = [];
    const unsub = workflow.graph.subscribe("task_complete", (taskId, output) => {
      // The map node itself emits the aggregated array output; inner iterations
      // emit a scalar `processed`. Each cloned iteration gets a fresh uuid, so we
      // count the inner completions rather than assert on their ids.
      if (String(taskId) !== mapTask.id && typeof output?.processed === "number") {
        innerOutputs.push(output.processed);
      }
    });

    await workflow.run({ item: [1, 2, 3] });
    unsub();

    // One bridged inner task_complete per item, carrying the doubled value.
    expect(innerOutputs.sort((a, b) => a - b)).toEqual([2, 4, 6]);
  });

  it("does not leak the subgraph bridge after a failed run (no double-emit on re-run)", async () => {
    let attempt = 0;
    class FailFirstThenPass extends Task<{ value: number }, { value: number }> {
      static override readonly type = "TCEFailFirstThenPass";
      static override readonly category = "Test";
      static override title = "Fail then pass";
      static override description = "Throws on first run, succeeds after";
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "number" } },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "number" } },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
      override async execute(input: { value: number }): Promise<{ value: number }> {
        attempt += 1;
        if (attempt === 1) throw new Error("first attempt fails");
        return { value: (input.value ?? 0) + 1 };
      }
    }
    TaskRegistry.registerTask(FailFirstThenPass as never);

    const subGraph = new TaskGraph();
    subGraph.addTask(new FailFirstThenPass({ id: "leaky" }));
    const group = new GraphAsTask({ id: "lgroup", subGraph });
    const top = new TaskGraph();
    top.addTask(group);

    const seen: string[] = [];
    const unsub = top.subscribe("task_complete", (taskId) => seen.push(String(taskId)));

    // First run rejects (inner throws) — the bridge MUST be torn down in finally.
    await top.run({ value: 5 }).catch(() => {});
    // Second run succeeds. A leaked first-run bridge would double-emit "leaky".
    await top.run({ value: 5 }).catch(() => {});
    unsub();

    expect(seen.filter((id) => id === "leaky")).toHaveLength(1);
  });
});

describe("bridgeSubGraphTaskEvents depth cap", () => {
  // Each test installs a stub logger and restores a NullLogger after, so warn
  // spies do not leak into other tests (and we never emit to the real console).
  let warnSpy: ReturnType<typeof vi.fn>;

  function installStubLogger(): void {
    warnSpy = vi.fn();
    const stub: ILogger = {
      debug: () => {},
      info: () => {},
      warn: warnSpy as unknown as ILogger["warn"],
      error: () => {},
      fatal: () => {},
      child() {
        return stub;
      },
      time: () => {},
      timeEnd: () => {},
      group: () => {},
      groupEnd: () => {},
    };
    setLogger(stub);
  }

  afterEach(() => {
    setLogger(new NullLogger());
  });

  it("stops bridging past maxDepth (default 16)", () => {
    installStubLogger();
    // Build a chain of TaskGraphs: g0 (top) -> g1 -> g2 -> ... -> gN (innermost).
    // Bridging is chained so each gK forwards into gK-1, mirroring how a stack
    // of GraphAsTask wrappers nests bridges at run time.
    const N = 20;
    const graphs: TaskGraph[] = [];
    for (let i = 0; i <= N; i++) graphs.push(new TaskGraph());

    const unbridges: Array<() => void> = [];
    for (let i = 1; i <= N; i++) {
      // graphs[i] is the inner subgraph; graphs[i-1] is its parent.
      unbridges.push(bridgeSubGraphTaskEvents(graphs[i], graphs[i - 1]));
    }

    // Bridges install outermost-first, so the levels that hit the cap are the
    // innermost ones (i = 17..N): those bridges are dropped and install no
    // listeners. The deepest level whose outgoing bridge is still active is
    // graphs[16] (bridge i=16, depth 15 < 16). Track where an emit lands.
    let reachedDepths: number[] = [];
    for (let i = 0; i < graphs.length; i++) {
      const depth = i;
      graphs[i].subscribe("task_progress", () => {
        reachedDepths.push(depth);
      });
    }

    // Emit from the deepest still-bridged node: it must propagate through all 16
    // active bridges down to the outermost graph (g0), reaching levels 0..16.
    graphs[16].emit("task_progress", "inner-id", 42, "msg");
    expect(reachedDepths.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: 17 }, (_, k) => k)
    );

    // Emit from the innermost (over-cap) node: its bridge was dropped, so the
    // event reaches only that node — it does not propagate up at all.
    reachedDepths = [];
    graphs[N].emit("task_progress", "inner-id", 7, "msg");
    expect(reachedDepths).toEqual([N]);

    // The cap fired (depth reached 16), producing at least one warn.
    expect(warnSpy).toHaveBeenCalled();

    unbridges.forEach((off) => off());
  });

  it("logs warning with depth fields when the cap is hit", () => {
    installStubLogger();
    const N = 18;
    const graphs: TaskGraph[] = [];
    for (let i = 0; i <= N; i++) graphs.push(new TaskGraph());
    const unbridges: Array<() => void> = [];
    for (let i = 1; i <= N; i++) {
      unbridges.push(bridgeSubGraphTaskEvents(graphs[i], graphs[i - 1]));
    }

    expect(warnSpy).toHaveBeenCalled();
    const firstCall = warnSpy.mock.calls[0];
    expect(firstCall[0]).toBe("bridgeSubGraphTaskEvents depth cap hit; dropping bridge");
    expect(firstCall[1]).toEqual({ depth: 16, maxDepth: 16 });

    unbridges.forEach((off) => off());
  });

  it("accepts a custom maxDepth override", () => {
    installStubLogger();
    const N = 6;
    const graphs: TaskGraph[] = [];
    for (let i = 0; i <= N; i++) graphs.push(new TaskGraph());

    const unbridges: Array<() => void> = [];
    for (let i = 1; i <= N; i++) {
      // Explicitly pass maxDepth=4 to each level. Depth is derived from the
      // parent's stamped marker, so the first call to exceed the cap is the
      // bridge whose computed depth is 4.
      unbridges.push(bridgeSubGraphTaskEvents(graphs[i], graphs[i - 1], undefined, 4));
    }

    expect(warnSpy).toHaveBeenCalled();
    const firstCall = warnSpy.mock.calls.find(
      (c) => c[0] === "bridgeSubGraphTaskEvents depth cap hit; dropping bridge"
    );
    expect(firstCall).toBeDefined();
    expect(firstCall![1]).toEqual({ depth: 4, maxDepth: 4 });

    unbridges.forEach((off) => off());
  });

  it("stamped over-cap subgraph prevents downstream bridges from restarting depth", () => {
    installStubLogger();
    // Build a 5-level chain with maxDepth=2. Bridges install left-to-right
    // (outermost first). The first call to exceed the cap MUST stamp the
    // subgraph so the next bridge (whose parent is that subgraph) also sees
    // depth >= maxDepth — otherwise the parent's BRIDGE_DEPTH reads as
    // undefined, depth resets to 0, and the cap leaks downstream.
    const maxDepth = 2;
    const N = 5;
    const graphs: TaskGraph[] = [];
    for (let i = 0; i <= N; i++) graphs.push(new TaskGraph());

    const reached: number[] = [];
    for (let i = 0; i < graphs.length; i++) {
      const depth = i;
      graphs[i].subscribe("task_progress", () => {
        reached.push(depth);
      });
    }

    const unbridges: Array<() => void> = [];
    for (let i = 1; i <= N; i++) {
      unbridges.push(bridgeSubGraphTaskEvents(graphs[i], graphs[i - 1], undefined, maxDepth));
    }

    // graphs[1] and graphs[2] install (depth 0, 1). graphs[3] hits cap and
    // stamps itself at maxDepth so graphs[4] and graphs[5] also no-op. Emit
    // from the innermost graph: only its own subscriber should fire — every
    // bridge i=3..5 short-circuited, so no event propagates outward at all.
    graphs[N].emit("task_progress", "inner-id", 42, "msg");

    // No bridge from level 2 onward installed, so only the innermost graph
    // (depth N) saw the emit. depth=0 (outermost) must NOT be reached.
    expect(reached).toEqual([N]);
    expect(reached).not.toContain(0);

    unbridges.forEach((off) => off());
  });

  it("warn fires exactly once per parentGraph at over-cap", () => {
    installStubLogger();
    const parent = new TaskGraph();
    // Call 50 times with the same parent at over-cap (depth seeded above cap).
    const teardowns: Array<() => void> = [];
    for (let i = 0; i < 50; i++) {
      const sub = new TaskGraph();
      teardowns.push(bridgeSubGraphTaskEvents(sub, parent, 16, 16));
    }

    const capCalls = warnSpy.mock.calls.filter(
      (c) => c[0] === "bridgeSubGraphTaskEvents depth cap hit; dropping bridge"
    );
    expect(capCalls).toHaveLength(1);

    teardowns.forEach((off) => off());
  });

  it("distinct parents at over-cap each warn once", () => {
    installStubLogger();
    const parentA = new TaskGraph();
    const parentB = new TaskGraph();
    const subA = new TaskGraph();
    const subB = new TaskGraph();

    const off1 = bridgeSubGraphTaskEvents(subA, parentA, 16, 16);
    const off2 = bridgeSubGraphTaskEvents(subB, parentB, 16, 16);
    // Repeat each parent a few more times — should not produce additional warns.
    const off3 = bridgeSubGraphTaskEvents(new TaskGraph(), parentA, 16, 16);
    const off4 = bridgeSubGraphTaskEvents(new TaskGraph(), parentB, 16, 16);

    const capCalls = warnSpy.mock.calls.filter(
      (c) => c[0] === "bridgeSubGraphTaskEvents depth cap hit; dropping bridge"
    );
    expect(capCalls).toHaveLength(2);

    off1();
    off2();
    off3();
    off4();
  });
});
