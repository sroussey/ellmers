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

/** A provider cache-storage charge: no counters, one `extra` figure. */
const storageCharge: Usage = {
  input: undefined,
  output: undefined,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: { cacheStorageTokenHours: 500_000 },
};

class SpendingTask extends Task<Record<string, never>, { text: string }> {
  static override readonly type = "LifetimeSpendingTask";
  static override readonly category = "Test";
  static override readonly title = "Lifetime spending task";
  static override readonly description = "Reports a fixed usage total.";
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

  async *executeStream(): AsyncGenerator<StreamEvent> {
    yield { type: "finish", data: {} as Record<string, never>, usage: usage(10, 5) };
  }
}

/**
 * Owns a spending child and runs it via `child.run()` — the `context.own` +
 * `task.run()` pattern, not a GraphAsTask subgraph. Keeps the child reachable
 * so a test can run it again AFTER the owning graph run is over.
 */
class OwningTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "LifetimeOwningTask";
  static override readonly category = "Test";
  static override readonly title = "Lifetime owning task";
  static override readonly description = "Owns and runs a spending child.";
  static override readonly cacheable = false;

  public child: SpendingTask | undefined;
  /** Snapshot of the child's stamped sinks taken while the parent run is live. */
  public sinksDuringRun: { usage: boolean; retire: boolean; late: boolean } | undefined;

  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }

  override async execute(
    _input: Record<string, never>,
    context: IExecuteContext
  ): Promise<Record<string, never>> {
    const child = context.own(new SpendingTask({ id: "owned-child" }));
    this.child = child;
    this.sinksDuringRun = {
      usage: child.runConfig.usageSink !== undefined,
      retire: child.runConfig.usageRetireSink !== undefined,
      late: child.runConfig.lateUsageSink !== undefined,
    };
    await child.run();
    return {};
  }
}

/**
 * A usage sink belongs to the run that supplied it. Two things kept one alive
 * past its run:
 *
 *  - `TaskRunner.handleStart` assigned each sink only `if (config.X)`, so a run
 *    that supplied none silently inherited the previous run's; and
 *  - `own()` stamps the sinks into the child's LONG-LIVED `runConfig`, and
 *    `Task.run` merges `{...this.runConfig, ...runConfig}` — so on a later
 *    standalone `child.run()` the stale sink arrives at `handleStart` as a
 *    *supplied* value, which the unconditional assignment alone cannot fix.
 *
 * Either half leaves a finished graph's aggregator absorbing spend from work
 * that is no longer part of it.
 */
describe("usage sink run lifetime", () => {
  it("does not report a later standalone run into the finished run's aggregator", async () => {
    const graph = new TaskGraph();
    const owner = new OwningTask({ id: "owner" });
    graph.addTask(owner);

    const graphUsageEvents: Usage[] = [];
    graph.subscribe("graph_usage", (total) => graphUsageEvents.push(total));

    await new TaskGraphRunner(graph).runGraph();

    expect(graph.runUsage).toEqual(usage(10, 5));
    const settled = graph.runUsage;
    const eventsAtRunEnd = graphUsageEvents.length;

    // The run is over; this is ordinary standalone use of a task that happens
    // to have been owned earlier. A late charge from THIS run belongs to this
    // run — and this run has no aggregator at all.
    await owner.child!.run();
    owner.child!.chargeLateUsage(storageCharge, "m");

    // `chargeLate` reaches the aggregator directly (no `task_usage` event), so
    // a leaked sink lands in a settled run's total and re-freezes
    // `graph.runUsage` through the retire listener that deliberately outlives
    // the settle.
    expect(graph.runUsage).toEqual(settled);
    expect(graph.usageAggregator.total).toEqual(settled);
    expect(graphUsageEvents.length).toBe(eventsAtRunEnd);
  });

  it("still delivers a late charge that settles after the run it belongs to", async () => {
    const graph = new TaskGraph();
    const owner = new OwningTask({ id: "owner" });
    graph.addTask(owner);

    await new TaskGraphRunner(graph).runGraph();

    // Scope guard for the test above: with no intervening standalone run the
    // charge is still this run's, and the sink must still be live. Clearing on
    // `run()`'s `finally` instead of on the next `handleStart` would break it.
    owner.child!.chargeLateUsage(storageCharge, "m");

    expect(graph.runUsage?.extra?.cacheStorageTokenHours).toBe(500_000);
  });

  it("restores the owned child's own sinks when the parent run ends", async () => {
    const graph = new TaskGraph();
    const owner = new OwningTask({ id: "owner" });
    graph.addTask(owner);

    await new TaskGraphRunner(graph).runGraph();

    // Restored to what the child had before `own()` stamped this run's values
    // — which, for a freshly constructed task, is nothing.
    expect(owner.child!.runConfig.usageSink).toBeUndefined();
    expect(owner.child!.runConfig.usageRetireSink).toBeUndefined();
    expect(owner.child!.runConfig.lateUsageSink).toBeUndefined();
  });

  it("still stamps the sinks onto an owned child during the parent run", async () => {
    const graph = new TaskGraph();
    const owner = new OwningTask({ id: "owner" });
    graph.addTask(owner);

    await new TaskGraphRunner(graph).runGraph();

    // Regression guard for the restore above: the stamp must still happen, or
    // a child running via `child.run()` never reaches the run total at all.
    expect(owner.sinksDuringRun).toEqual({ usage: true, retire: true, late: true });
  });

  it("attributes a second graph run's spend to that run only", async () => {
    const graph = new TaskGraph();
    const owner = new OwningTask({ id: "owner" });
    graph.addTask(owner);
    const runner = new TaskGraphRunner(graph);

    await runner.runGraph();
    await runner.runGraph();

    // The aggregator resets per run, so each run reports one child execution.
    // A leaked sink would have the second run's child publishing twice.
    expect(graph.runUsage).toEqual(usage(10, 5));
  });
});
