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

/** What the child's execution itself is billed. */
const SPEND = usage(10, 5);
/** A charge that settles after the child finished — cache storage at disposal. */
const CHARGE = usage(100, 0);

class SpendingChild extends Task<Record<string, never>, { text: string }> {
  static override readonly type = "LateChargeSpendingChild";
  static override readonly category = "Test";
  static override readonly title = "Late charge spending child";
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
    yield { type: "finish", data: {} as Record<string, never>, usage: SPEND };
  }
}

/**
 * A charge that settles after an owned child finished travels TWO channels:
 *
 *  - `Task.chargeLateUsage` re-emits the child's new cumulative total on the
 *    `usage` event (correct — the contract is replace, not accumulate, so
 *    ordinary listeners need the whole total); and
 *  - `reportLateUsage` sends the bare delta to the late-usage sink, which the
 *    aggregator merges into `retired`.
 *
 * `own()`'s bridge subscribes to the first and republishes it as a live
 * cumulative bucket for a child whose bucket was already retired on
 * completion. So the aggregate became `2·spend + 2·charge` — the retired
 * bucket, plus a fresh live bucket restating the same spend, plus the charge
 * counted in each. `sweep()` preserves it by folding the live bucket in.
 *
 * The charge must be counted exactly once, and the fix keeps the delta channel
 * (which is what the aggregator's `chargeLate` is for) rather than the re-emit.
 */
describe("late charge on a completed owned child", () => {
  /** Owns a child, runs it, then charges it — all inside the parent's run. */
  class OwnerChargingAfterChild extends Task<Record<string, never>, Record<string, never>> {
    static override readonly type = "OwnerChargingAfterChild";
    static override readonly category = "Test";
    static override readonly title = "Owner charging after child";
    static override readonly description = "Charges an owned child after it completed.";
    static override readonly cacheable = false;

    /** Set by the test so the owner can read the run total mid-run. */
    public probe: (() => void) | undefined;

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
      const child = context.own(new SpendingChild({ id: "owned-child" }));
      await child.run();
      child.chargeLateUsage(CHARGE, "m");
      this.probe?.();
      return {};
    }
  }

  function build(): { graph: TaskGraph; owner: OwnerChargingAfterChild } {
    const graph = new TaskGraph();
    const owner = new OwnerChargingAfterChild({ id: "owner" });
    graph.addTask(owner);
    return { graph, owner };
  }

  it("counts the charge once while the parent run is still going", async () => {
    const { graph, owner } = build();
    let midRunTotal: Usage | undefined;
    owner.probe = (): void => {
      midRunTotal = graph.usageAggregator.total;
    };

    await new TaskGraphRunner(graph).runGraph();

    // Not 2·spend + 2·charge — `{input: 220, output: 10}`.
    expect(midRunTotal).toEqual(usage(110, 5));
  });

  it("still counts it once after the run-end sweep", async () => {
    const { graph } = build();

    await new TaskGraphRunner(graph).runGraph();

    // `sweep()` retires whatever is still live, so a duplicate live bucket is
    // preserved into the persisted total rather than discarded.
    expect(graph.runUsage).toEqual(usage(110, 5));
  });

  it("still delivers the charge at all", async () => {
    const { graph } = build();

    await new TaskGraphRunner(graph).runGraph();

    // Guard against over-suppressing: silencing the re-emit must not also
    // silence the delta channel, which is the one that carries the charge.
    expect(graph.runUsage?.input).toBe(110);
    expect(graph.usageAggregator.byTask().get("owned-child")?.input).toBe(110);
  });

  it("still publishes a live owned child's usage", async () => {
    class PlainOwner extends Task<Record<string, never>, Record<string, never>> {
      static override readonly type = "PlainLateChargeOwner";
      static override readonly category = "Test";
      static override readonly title = "Plain owner";
      static override readonly description = "Owns and runs a child.";
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
        const child = context.own(new SpendingChild({ id: "owned-child" }));
        await child.run();
        return {};
      }
    }

    const graph = new TaskGraph();
    graph.addTask(new PlainOwner({ id: "owner" }));
    await new TaskGraphRunner(graph).runGraph();

    expect(graph.runUsage).toEqual(SPEND);
  });

  it("still sums successive runs of a reused owned child", async () => {
    class ReusingOwner extends Task<Record<string, never>, Record<string, never>> {
      static override readonly type = "ReusingLateChargeOwner";
      static override readonly category = "Test";
      static override readonly title = "Reusing owner";
      static override readonly description = "Runs one owned child twice.";
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
        const child = context.own(new SpendingChild({ id: "owned-child" }));
        await child.run();
        await child.run();
        return {};
      }
    }

    const graph = new TaskGraph();
    graph.addTask(new ReusingOwner({ id: "owner" }));
    await new TaskGraphRunner(graph).runGraph();

    // The suppression is per-execution: a completed child that runs AGAIN must
    // publish its second execution, or gating on completion silently drops
    // every run after the first.
    expect(graph.runUsage).toEqual(usage(20, 10));
  });
});
