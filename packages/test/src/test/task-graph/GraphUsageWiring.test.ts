/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent, Usage } from "@workglow/task-graph";
import { Task, TaskGraph, TaskGraphRunner } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

const usage = (input: number, output: number): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

/** Emits a mid-stream usage snapshot then a final total, exercising `task_usage`. */
class UsageEmittingTask extends Task<Record<string, never>, { text: string }> {
  static override readonly type = "UsageEmittingTask";
  static override readonly category = "Test";
  static override readonly title = "Usage emitting task";
  static override readonly description = "Emits a usage snapshot for graph-wiring tests.";
  static override readonly cacheable = false;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<{ text: string }> {
    return { text: "" };
  }

  async *executeStream(
    _input: Record<string, never>,
    _context: IExecuteContext
  ): AsyncGenerator<StreamEvent> {
    yield { type: "usage", usage: usage(10, 2) };
    yield { type: "text-delta", port: "text", textDelta: "hi" };
    yield { type: "finish", data: {} as Record<string, never>, usage: usage(10, 5) };
  }
}

describe("graph-level usage wiring", () => {
  it("forwards task_usage into graph_usage and settles graph.runUsage", async () => {
    const graph = new TaskGraph();
    graph.addTask(new UsageEmittingTask({ id: "t1" }));
    const runner = new TaskGraphRunner(graph);

    const graphUsageEvents: Usage[] = [];
    graph.subscribe("graph_usage", (total) => graphUsageEvents.push(total));

    await runner.runGraph();

    expect(graphUsageEvents.length).toBeGreaterThan(0);
    expect(graphUsageEvents.at(-1)).toEqual(usage(10, 5));
    expect(graph.runUsage).toEqual(usage(10, 5));
  });

  it("has a settled graph.runUsage by the time `complete` fires", async () => {
    const graph = new TaskGraph();
    graph.addTask(new UsageEmittingTask({ id: "t1" }));
    const runner = new TaskGraphRunner(graph);

    let runUsageAtComplete: Usage | undefined;
    graph.subscribe("complete", () => {
      runUsageAtComplete = graph.runUsage;
    });

    await runner.runGraph();

    // This is the ordering assertion: the run-end sweep must retire the live
    // usage bucket into graph.runUsage BEFORE `complete` is emitted, so a
    // listener reading graph.runUsage from inside its `complete` handler sees
    // the settled total rather than undefined.
    expect(runUsageAtComplete).toEqual(usage(10, 5));
  });
});
