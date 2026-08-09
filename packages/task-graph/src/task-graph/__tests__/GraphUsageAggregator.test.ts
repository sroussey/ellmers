/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { Usage } from "../../task/StreamTypes";
import { GraphUsageAggregator } from "../GraphUsageAggregator";

const usage = (input: number, output: number): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

describe("GraphUsageAggregator", () => {
  it("replaces rather than accumulates repeated snapshots for one task", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("t1", usage(100, 1), "m");
    agg.observe("t1", usage(100, 5), "m");
    agg.observe("t1", usage(100, 9), "m");

    expect(agg.total).toEqual(usage(100, 9));
  });

  it("sums distinct tasks", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("t1", usage(10, 1), "m");
    agg.observe("t2", usage(20, 2), "m");

    expect(agg.total).toEqual(usage(30, 3));
  });

  it("keeps two models on one task in separate buckets", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("t1", usage(10, 1), "embed");
    agg.observe("t1", usage(20, 2), "generate");

    expect(agg.total).toEqual(usage(30, 3));
  });

  it("sums loop iterations rather than keeping only the last", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("loop", usage(10, 1), "m");
    agg.retire("loop");
    agg.observe("loop", usage(10, 1), "m");
    agg.retire("loop");

    expect(agg.total).toEqual(usage(20, 2));
  });

  it("retires a failed-then-retried execution on a non-monotonic snapshot", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("t1", usage(100, 40), "m");
    // No task_complete — the alternative failed. A smaller total can only be a
    // fresh execution.
    agg.observe("t1", usage(100, 3), "m");

    expect(agg.total).toEqual(usage(200, 43));
  });

  it("reports retired executions to subscribers exactly once", () => {
    const agg = new GraphUsageAggregator();
    const rows: string[] = [];
    agg.onRetire((row) => rows.push(`${row.taskId}:${row.usage.output}`));

    agg.observe("t1", usage(10, 4), "m");
    agg.retire("t1");
    agg.retire("t1");

    expect(rows).toEqual(["t1:4"]);
  });

  it("sweeps still-live executions at run end", () => {
    const agg = new GraphUsageAggregator();
    const rows: string[] = [];
    agg.onRetire((row) => rows.push(row.taskId));

    agg.observe("t1", usage(10, 4), "m");
    agg.sweep();

    expect(rows).toEqual(["t1"]);
    expect(agg.total).toEqual(usage(10, 4));
  });
});
