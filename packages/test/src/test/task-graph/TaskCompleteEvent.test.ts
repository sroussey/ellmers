/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dataflow, Task, TaskGraph, TaskRegistry } from "@workglow/task-graph";
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
});
