/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import {
  Dataflow,
  FallbackTask,
  GraphAsTask,
  MapTask,
  Task,
  TaskGraph,
  TaskRegistry,
  WhileTask,
  Workflow,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

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
