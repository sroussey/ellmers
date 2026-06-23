/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";
import { Dataflow, GraphAsTask, Task, TaskGraph, TaskRegistry } from "@workglow/task-graph";
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
});
