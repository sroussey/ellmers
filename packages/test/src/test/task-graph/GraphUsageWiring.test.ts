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

/**
 * Stands in for a task that mints a provider cache checkpoint: it reports its
 * generation spend during the run, and the charge for holding the cache is
 * only known when the run's ResourceScope disposes the session at run end —
 * long after this task's own `usage` subscription was torn down.
 */
class LateChargingTask extends Task<Record<string, never>, { text: string }> {
  static override readonly type = "LateChargingTask";
  static override readonly category = "Test";
  static override readonly title = "Late charging task";
  static override readonly description = "Reports a storage charge at scope disposal.";
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
    context: IExecuteContext
  ): AsyncGenerator<StreamEvent> {
    context.resourceScope!.register(`late:${String(this.id)}`, async () => {
      this.chargeLateUsage(storageCharge, "m");
    });
    yield { type: "finish", data: {} as Record<string, never>, usage: usage(10, 5) };
  }
}

/**
 * Owns a spending child and runs it via `child.run()` — the sec / embarc-data
 * extraction pattern (`context.own` + `task.run`), not a GraphAsTask subgraph.
 */
class OwningSpendTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "OwningSpendTask";
  static override readonly category = "Test";
  static override readonly title = "Owning spend task";
  static override readonly description = "Owns a child that reports usage, then runs it.";
  static override readonly cacheable = false;

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
    const child = context.own(new UsageEmittingTask({ id: "owned-child" }));
    await child.run();
    return {};
  }
}

describe("owned child spend reaches the run total", () => {
  it("folds context.own + child.run() usage into graph.runUsage and graph_usage", async () => {
    const graph = new TaskGraph();
    graph.addTask(new OwningSpendTask({ id: "owner" }));
    const graphUsageEvents: Usage[] = [];
    graph.subscribe("graph_usage", (total) => graphUsageEvents.push(total));

    await new TaskGraphRunner(graph).runGraph();

    // The child's StreamProcessor sets child.runUsage, but the graph scheduler
    // never sees that task — only an own()-time bridge can publish task_usage.
    expect(graph.runUsage).toEqual(usage(10, 5));
    expect(graphUsageEvents.at(-1)).toEqual(usage(10, 5));
  });

  it("sums successive runs of a reused owned child rather than keeping only the last", async () => {
    class ReusingOwner extends Task<Record<string, never>, Record<string, never>> {
      static override readonly type = "ReusingOwner";
      static override readonly category = "Test";
      static override readonly cacheable = false;
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
        // Same child instance, two runs — the sec extraction reuse pattern.
        const child = context.own(new UsageEmittingTask({ id: "owned-child" }));
        await child.run();
        await child.run();
        return {};
      }
    }

    const graph = new TaskGraph();
    graph.addTask(new ReusingOwner({ id: "owner" }));
    await new TaskGraphRunner(graph).runGraph();

    expect(graph.runUsage).toEqual(usage(20, 10));
  });
});

describe("a charge that settles after the run", () => {
  it("adds a disposal-time charge to graph.runUsage and graph_usage", async () => {
    const graph = new TaskGraph();
    graph.addTask(new LateChargingTask({ id: "t1" }));
    const graphUsageEvents: Usage[] = [];
    graph.subscribe("graph_usage", (total) => graphUsageEvents.push(total));

    // runGraph owns the ResourceScope here, so it disposes the checkpoint and
    // awaits that disposal before resolving.
    await new TaskGraphRunner(graph).runGraph();

    expect(graph.runUsage?.input).toBe(10);
    expect(graph.runUsage?.output).toBe(5);
    expect(graph.runUsage?.extra?.cacheStorageTokenHours).toBe(500_000);
    expect(graphUsageEvents.at(-1)?.extra?.cacheStorageTokenHours).toBe(500_000);
  });

  it("counts a late charge once, not once per usage event", async () => {
    const graph = new TaskGraph();
    graph.addTask(new LateChargingTask({ id: "t1" }));

    await new TaskGraphRunner(graph).runGraph();

    // The charge is a delta merged into the retired bucket. Re-emitting it as
    // a cumulative task snapshot as well would fold it in a second time.
    expect(graph.usageAggregator.byTask().get("t1")?.extra?.cacheStorageTokenHours).toBe(500_000);
  });

  it("rolls a nested task's late charge up to the root run total", async () => {
    const inner = new TaskGraph();
    inner.addTask(new LateChargingTask({ id: "inner-1" }));
    const outer = new TaskGraph();
    outer.addTask(new GraphAsTask({ id: "compound", subGraph: inner }));

    await new TaskGraphRunner(outer).runGraph();

    // The subgraph's own aggregator settled when the compound task finished,
    // so a charge arriving after that has to reach the ROOT run's aggregator.
    // Only an inherited sink can do it — the subgraph event bridge is already
    // torn down by then.
    expect(outer.runUsage?.extra?.cacheStorageTokenHours).toBe(500_000);
  });
});
