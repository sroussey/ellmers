/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { TaskGraph } from "../../task-graph/TaskGraph";
import { TaskGraphRunner } from "../../task-graph/TaskGraphRunner";
import type { IExecuteContext } from "../../task/ITask";
import type { StreamEvent, Usage } from "../../task/StreamTypes";
import { Task } from "../../task/Task";
import { attachUsageRecorder } from "../attachUsageRecorder";
import { RunUsagePrimaryKeyNames, RunUsageSchema } from "../RunUsageSchema";

const usage = (input: number, output: number): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

class SpendingTask extends Task<Record<string, never>, { text: string }> {
  static override readonly type = "SpendingTask";
  static override readonly category = "Test";
  static override readonly title = "Spending task";
  static override readonly description =
    "Reports a token total so a recorder has something to write.";
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
    yield { type: "finish", data: {} as Record<string, never>, usage: usage(30, 7) };
  }
}

describe("attachUsageRecorder across a run", () => {
  it("records rows for a recorder attached before the run starts", async () => {
    const graph = new TaskGraph();
    graph.addTask(new SpendingTask({ id: "t1" }));
    const storage = new InMemoryTabularStorage(RunUsageSchema, RunUsagePrimaryKeyNames);

    // A caller can only reach the aggregator before calling run() — which is
    // exactly when a run-start swap would strand the subscription, writing
    // nothing and reporting no error.
    const detach = attachUsageRecorder(graph.usageAggregator, storage, { runId: "run-1" });
    await new TaskGraphRunner(graph).runGraph();
    await detach();

    const rows = await storage.getAll();
    expect(rows).toHaveLength(1);
    expect(rows![0].runId).toBe("run-1");
    expect(rows![0].taskId).toBe("t1");
    expect(rows![0].input).toBe(30);
    expect(rows![0].output).toBe(7);
  });

  it("keeps recording across a second run of the same graph", async () => {
    const graph = new TaskGraph();
    graph.addTask(new SpendingTask({ id: "t1" }));
    const storage = new InMemoryTabularStorage(RunUsageSchema, RunUsagePrimaryKeyNames);

    const detach = attachUsageRecorder(graph.usageAggregator, storage, { runId: "run-1" });
    const runner = new TaskGraphRunner(graph);
    await runner.runGraph();
    await runner.runGraph();
    await detach();

    expect(await storage.getAll()).toHaveLength(2);
  });
});
