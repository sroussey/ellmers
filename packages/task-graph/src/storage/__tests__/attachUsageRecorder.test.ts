/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import { describe, expect, it } from "vitest";
import { GraphUsageAggregator } from "../../task-graph/GraphUsageAggregator";
import { RunUsagePrimaryKeyNames, RunUsageSchema } from "../RunUsageSchema";
import { attachUsageRecorder } from "../attachUsageRecorder";

const usage = (input: number, output: number) => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

describe("attachUsageRecorder", () => {
  it("writes one row per retired execution, not per event", async () => {
    const storage = new InMemoryTabularStorage(RunUsageSchema, RunUsagePrimaryKeyNames);
    const aggregator = new GraphUsageAggregator();
    const detach = attachUsageRecorder(aggregator, storage, { runId: "run-1" });

    aggregator.observe("t1", usage(100, 1), "m");
    aggregator.observe("t1", usage(100, 5), "m");
    aggregator.observe("t1", usage(100, 9), "m");
    aggregator.retire("t1");
    await detach();

    const rows = (await storage.getAll()) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].output).toBe(9);
    expect(rows[0].taskId).toBe("t1");
    expect(rows[0].runId).toBe("run-1");
  });

  it("stores an unreported counter as null, never 0", async () => {
    const storage = new InMemoryTabularStorage(RunUsageSchema, RunUsagePrimaryKeyNames);
    const aggregator = new GraphUsageAggregator();
    const detach = attachUsageRecorder(aggregator, storage, { runId: "run-2" });

    aggregator.observe("t1", usage(10, 2), "m");
    aggregator.retire("t1");
    await detach();

    const rows = (await storage.getAll()) ?? [];
    // The zero-vs-absent rule has to survive into the database or it was never
    // really enforced.
    expect(rows[0].cached).toBe(null);
    expect(rows[0].cacheWrite).toBe(null);
  });

  it("gives a task that executes twice two rows", async () => {
    const storage = new InMemoryTabularStorage(RunUsageSchema, RunUsagePrimaryKeyNames);
    const aggregator = new GraphUsageAggregator();
    const detach = attachUsageRecorder(aggregator, storage, { runId: "run-3" });

    aggregator.observe("loop", usage(10, 1), "m");
    aggregator.retire("loop");
    aggregator.observe("loop", usage(10, 1), "m");
    aggregator.retire("loop");
    await detach();

    const rows = (await storage.getAll()) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sequence).sort()).toEqual([0, 1]);
  });
});
