/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { Usage } from "../../task/StreamTypes";
import type { RetiredUsage } from "../GraphUsageAggregator";
import { GraphUsageAggregator, UNNAMED_MODEL } from "../GraphUsageAggregator";

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

  describe("rollups", () => {
    it("folds the model axis so a two-model task reports one total", () => {
      const agg = new GraphUsageAggregator();
      agg.observe("t1", usage(10, 1), "embed");
      agg.observe("t1", usage(20, 2), "generate");

      expect(agg.byTask().get("t1")).toEqual(usage(30, 3));
    });

    it("folds the task axis so two tasks on one model report one total", () => {
      const agg = new GraphUsageAggregator();
      agg.observe("t1", usage(10, 1), "m");
      agg.observe("t2", usage(20, 2), "m");

      expect(agg.byModel().get("m")).toEqual(usage(30, 3));
    });

    it("keeps each rollup summing to the run total", () => {
      const agg = new GraphUsageAggregator();
      agg.observe("t1", usage(10, 1), "embed");
      agg.observe("t1", usage(20, 2), "generate");
      agg.observe("t2", usage(5, 3), "generate");
      agg.retire("t1");

      const sum = (rows: Iterable<Usage>): Usage =>
        [...rows].reduce((a, b) => usage(a.input! + b.input!, a.output! + b.output!), usage(0, 0));

      expect(sum(agg.byTask().values())).toEqual(agg.total);
      expect(sum(agg.byModel().values())).toEqual(agg.total);
    });

    it("counts every iteration of a task that executes more than once", () => {
      const agg = new GraphUsageAggregator();
      agg.observe("loop", usage(10, 1), "m");
      agg.retire("loop");
      agg.observe("loop", usage(10, 1), "m");

      expect(agg.byTask().get("loop")).toEqual(usage(20, 2));
      expect(agg.byModel().get("m")).toEqual(usage(20, 2));
    });

    it("keeps an unnamed model out of the bucket of one literally named 'unnamed'", () => {
      const agg = new GraphUsageAggregator();
      agg.observe("t1", usage(10, 1), undefined);
      agg.observe("t2", usage(20, 2), "unnamed");
      agg.retire("t1");

      expect(agg.byModel().get(UNNAMED_MODEL)).toEqual(usage(10, 1));
      expect(agg.byModel().get("unnamed")).toEqual(usage(20, 2));
    });

    it("clears both rollups for a fresh run", () => {
      const agg = new GraphUsageAggregator();
      agg.observe("t1", usage(10, 1), "m");
      agg.sweep();
      agg.reset();

      expect([...agg.byTask()]).toEqual([]);
      expect([...agg.byModel()]).toEqual([]);
    });
  });

  it("does not collide task/model pairs whose composed strings would clash", () => {
    const agg = new GraphUsageAggregator();
    const rows: RetiredUsage[] = [];
    agg.onRetire((row) => rows.push(row));

    // A composed `${taskId} ${modelId}` string key would render both of
    // these as the identical "foo bar baz" bucket.
    agg.observe("foo bar", usage(10, 1), "baz");
    agg.observe("foo", usage(100, 20), "bar baz");

    expect(agg.total).toEqual(usage(110, 21));

    agg.sweep();

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ taskId: "foo bar", modelId: "baz", usage: usage(10, 1) });
    expect(rows).toContainEqual({ taskId: "foo", modelId: "bar baz", usage: usage(100, 20) });
  });
});
