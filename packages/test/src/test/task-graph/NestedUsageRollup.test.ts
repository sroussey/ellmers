/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent, Usage } from "@workglow/task-graph";
import { GraphAsTask, Task, TaskGraph, TaskGraphRunner } from "@workglow/task-graph";
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

/** Reports a fixed token total, so a rollup has something to carry upward. */
class SpendingTask extends Task<Record<string, never>, { text: string }> {
  static override readonly type = "NestedSpendingTask";
  static override readonly category = "Test";
  static override readonly title = "Nested spending task";
  static override readonly description = "Reports a token total from inside a subgraph.";
  static override readonly cacheable = false;

  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const;
  }

  override async execute(): Promise<{ text: string }> {
    return { text: "" };
  }

  async *executeStream(
    _input: Record<string, never>,
    _context: IExecuteContext
  ): AsyncGenerator<StreamEvent> {
    yield { type: "finish", data: {} as Record<string, never>, usage: usage(40, 6) };
  }
}

describe("nested task spend reaches the run total", () => {
  it("rolls a subgraph task's usage up into the parent graph's run total", async () => {
    const inner = new TaskGraph();
    inner.addTask(new SpendingTask({ id: "inner-1" }));

    const outer = new TaskGraph();
    outer.addTask(new GraphAsTask({ id: "compound", subGraph: inner }));

    await new TaskGraphRunner(outer).runGraph();

    // A compound task's own execution reports nothing; the only route by which
    // its children's spend reaches the run total is the subgraph bridge
    // forwarding task_usage up to the parent graph.
    expect(outer.runUsage).toEqual(usage(40, 6));
  });

  it("sums two nested tasks rather than reporting only the last", async () => {
    const inner = new TaskGraph();
    inner.addTask(new SpendingTask({ id: "inner-1" }));
    inner.addTask(new SpendingTask({ id: "inner-2" }));

    const outer = new TaskGraph();
    outer.addTask(new GraphAsTask({ id: "compound", subGraph: inner }));

    await new TaskGraphRunner(outer).runGraph();

    expect(outer.runUsage).toEqual(usage(80, 12));
  });
});
