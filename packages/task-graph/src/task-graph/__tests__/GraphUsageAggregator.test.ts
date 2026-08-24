/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { Usage } from "../../task/StreamTypes";
import type { RetiredUsage } from "../GraphUsageAggregator";
import { EVICTED_TASKS, GraphUsageAggregator, UNNAMED_MODEL } from "../GraphUsageAggregator";

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

    it("bounds the per-task rollup without losing the spend it accounted for", () => {
      // A map over a corpus mints a fresh clone id per item, so the per-task
      // rollup would otherwise grow one row per item for the life of the run.
      const agg = new GraphUsageAggregator();
      const items = 2_000;
      for (let i = 0; i < items; i++) {
        agg.observe(`clone-${i}`, usage(1, 1), "m");
        agg.retire(`clone-${i}`);
      }

      const byTask = agg.byTask();
      // 512 real tasks plus the overflow bucket. The bucket is exempt from the
      // cap rather than counted against it: counted, the first overflow evicts
      // twice (a row leaves, the bucket takes its place, the size is unchanged)
      // and the steady state is one real task short of the constant.
      expect(byTask.size).toBe(513);
      expect([...byTask.keys()].filter((k) => k !== EVICTED_TASKS)).toHaveLength(512);

      const sum = (rows: Iterable<Usage>): Usage =>
        [...rows].reduce((a, b) => usage(a.input! + b.input!, a.output! + b.output!), usage(0, 0));
      // Evicted rows fold into one bucket rather than vanishing, so the rollup
      // still sums to the run total.
      expect(sum(byTask.values())).toEqual(usage(items, items));
      expect(agg.total).toEqual(usage(items, items));
      expect(byTask.get(EVICTED_TASKS)).toBeDefined();
      // The most recent tasks stay individually addressable.
      expect(byTask.get(`clone-${items - 1}`)).toEqual(usage(1, 1));
    });

    it("keeps a task that is still reporting, and evicts one that went quiet", () => {
      // `Map.set` on an existing key updates the value and leaves the insertion
      // order alone, so recording spend has to delete-then-set for the eviction
      // order to mean "least recently active" rather than "first ever seen".
      const agg = new GraphUsageAggregator();
      agg.observe("busy", usage(1, 1), "m");
      agg.retire("busy");
      agg.observe("quiet", usage(1, 1), "m");
      agg.retire("quiet");

      // Enough fresh tasks to overflow the cap, with `busy` reporting throughout.
      for (let i = 0; i < 600; i++) {
        agg.observe(`clone-${i}`, usage(1, 1), "m");
        agg.retire(`clone-${i}`);
        agg.observe("busy", usage(1, 1), "m");
        agg.retire("busy");
      }

      const byTask = agg.byTask();
      // Asserting the ACCUMULATED total, not mere presence: an evicted task is
      // re-added by its next retire, so `toBeDefined()` passes either way and
      // detects nothing. Only a row carrying all 601 executions proves `busy`
      // was never folded into the bucket and restarted.
      expect(byTask.get("busy")).toEqual(usage(601, 601));
      expect(byTask.get("quiet")).toBeUndefined();
      // Still nothing lost: the quiet task's spend lives in the overflow bucket.
      const sum = (rows: Iterable<Usage>): Usage =>
        [...rows].reduce((a, b) => usage(a.input! + b.input!, a.output! + b.output!), usage(0, 0));
      expect(sum(byTask.values())).toEqual(agg.total);
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

/** A provider cache-storage charge: no counters, one `extra` figure. */
const storageCharge = (tokenHours: number): Usage => ({
  input: undefined,
  output: undefined,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: { cacheStorageTokenHours: tokenHours },
});

describe("chargeLate", () => {
  it("adds a late charge to the run total instead of replacing a bucket", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("t1", usage(100, 20), "m");
    agg.retire("t1");

    agg.chargeLate("t1", storageCharge(500_000), "m");

    // A late charge is a delta against an execution that is already over, so
    // it merges. Routing it through `observe` would replace the retired
    // execution's real counters with a bucket that has none.
    expect(agg.total?.input).toBe(100);
    expect(agg.total?.output).toBe(20);
    expect(agg.total?.extra?.cacheStorageTokenHours).toBe(500_000);
  });

  it("files a late charge under the same task and model buckets", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("t1", usage(100, 20), "m");
    agg.retire("t1");

    agg.chargeLate("t1", storageCharge(500_000), "m");

    const byTask = agg.byTask().get("t1");
    expect(byTask?.input).toBe(100);
    expect(byTask?.extra?.cacheStorageTokenHours).toBe(500_000);
    const byModel = agg.byModel().get("m");
    expect(byModel?.input).toBe(100);
    expect(byModel?.extra?.cacheStorageTokenHours).toBe(500_000);
  });

  it("notifies retire subscribers so a recorder writes a row for it", () => {
    const agg = new GraphUsageAggregator();
    const rows: RetiredUsage[] = [];
    agg.onRetire((row) => rows.push(row));

    agg.chargeLate("t1", storageCharge(500_000), "m");

    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe("t1");
    expect(rows[0]!.modelId).toBe("m");
    expect(rows[0]!.usage.extra?.cacheStorageTokenHours).toBe(500_000);
  });
});

describe("a throwing retire subscriber", () => {
  it("does not fail the sweep when a listener throws", () => {
    const agg = new GraphUsageAggregator();
    const seen: RetiredUsage[] = [];
    agg.onRetire(() => {
      throw new Error("recorder blew up");
    });
    agg.onRetire((row) => seen.push(row));

    agg.observe("t1", usage(10, 1), "m");

    // One misbehaving telemetry subscriber must not take down the run that
    // produced the numbers, nor starve the subscribers registered after it.
    expect(() => agg.sweep()).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.taskId).toBe("t1");
  });

  it("does not fail a late charge when a listener throws", () => {
    const agg = new GraphUsageAggregator();
    const seen: RetiredUsage[] = [];
    agg.onRetire(() => {
      throw new Error("recorder blew up");
    });
    agg.onRetire((row) => seen.push(row));

    expect(() => agg.chargeLate("t1", storageCharge(1), "m")).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});

/**
 * An estimate is display feedback, not accounting. It is worth showing in the
 * live total while a call is in flight, but folding it into `retired` is what
 * makes a character-count guess reach `run_usage` and every cost figure derived
 * from it — indistinguishable, at that point, from a provider-stated number.
 */
describe("GraphUsageAggregator and estimated usage", () => {
  const estimate = (input: number, output: number): Usage => ({
    ...usage(input, output),
    estimated: true,
  });

  it("counts an estimated bucket in the live total", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("t1", estimate(30, 2), "m");

    // The whole point of the estimate is the moving ↑↓ counter during a call.
    expect(agg.total).toEqual(estimate(30, 2));
  });

  it("drops an estimated bucket on retire instead of accumulating it", () => {
    const agg = new GraphUsageAggregator();
    const seen: RetiredUsage[] = [];
    agg.onRetire((row) => seen.push(row));

    agg.observe("t1", estimate(30, 2), "m");
    agg.retire("t1");

    expect(agg.total).toBeUndefined();
    expect(agg.byTask().get("t1")).toBeUndefined();
    // No retirement row either: `attachUsageRecorder` writes one per retire, so
    // firing here would persist the guess.
    expect(seen).toEqual([]);
  });

  it("keeps a stated bucket for the same task", () => {
    const agg = new GraphUsageAggregator();
    agg.observe("t1", estimate(30, 2), "estimating-model");
    agg.observe("t2", usage(10, 1), "stating-model");
    agg.sweep();

    // Scope guard: the drop is per row, not per sweep.
    expect(agg.total).toEqual(usage(10, 1));
  });

  it("still accepts an estimated late charge through chargeLate", () => {
    const agg = new GraphUsageAggregator();
    agg.chargeLate("t1", estimate(5, 0), "m");

    // `chargeLate` is untouched: it is a delta reported by a caller that owns
    // the decision, not a live bucket this class retires.
    expect(agg.total?.input).toBe(5);
  });
});
