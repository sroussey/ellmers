/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
import { GraphAsTask, Task, TaskGraph } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { nodeUsage } from "./nodeUsage";

const SCHEMA = { type: "object", properties: {} } as never;

class LeafTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "LeafTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute() {
    return {};
  }
}

const usage = (input: number, output: number): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

function compound(id: string, childIds: readonly string[]): GraphAsTask {
  const inner = new TaskGraph();
  for (const childId of childIds) inner.addTask(new LeafTask({ id: childId }));
  return new GraphAsTask({ id, subGraph: inner });
}

describe("nodeUsage", () => {
  it("gives a leaf task its own total", () => {
    const task = new LeafTask({ id: "leaf" });
    const byTask = new Map([
      ["leaf", usage(10, 1)],
      ["other", usage(99, 9)],
    ]);

    expect(nodeUsage(task, byTask)).toEqual(usage(10, 1));
  });

  it("sums the subtree for a compound task, which reports nothing itself", () => {
    // A compound task withholds its children's usage from its own stream, so
    // only the child ids carry counts — a group node showing `byTask` for its
    // own id alone would render blank.
    const task = compound("group", ["a", "b"]);
    const byTask = new Map([
      ["a", usage(10, 1)],
      ["b", usage(20, 2)],
    ]);

    expect(nodeUsage(task, byTask)).toEqual(usage(30, 3));
  });

  it("descends through nested compound tasks", () => {
    const inner = new TaskGraph();
    inner.addTask(new LeafTask({ id: "deep" }));
    const outerGraph = new TaskGraph();
    outerGraph.addTask(new LeafTask({ id: "shallow" }));
    outerGraph.addTask(new GraphAsTask({ id: "mid", subGraph: inner }));
    const task = new GraphAsTask({ id: "top", subGraph: outerGraph });

    const byTask = new Map([
      ["shallow", usage(10, 1)],
      ["deep", usage(5, 4)],
    ]);

    expect(nodeUsage(task, byTask)).toEqual(usage(15, 5));
  });

  it("reports nothing for a compound task whose children spent nothing", () => {
    const task = compound("group", ["a"]);

    expect(nodeUsage(task, new Map())).toBeUndefined();
  });
});
