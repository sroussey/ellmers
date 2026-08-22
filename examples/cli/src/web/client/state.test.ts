/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../run-events/RunEventTypes";
import type { WebCommandNode } from "../commandTree";
import {
  applyRecord,
  emptyRunView,
  filterCommandTree,
  FULL_ITERATION_TRACKING_MAX,
  openPathsFor,
  orderedRows,
  reduceRunEvent,
  type RunViewState,
} from "./state";

const added = (id: string, label = id, depth = 0): RunEvent => ({
  k: "task_added",
  id,
  type: "T",
  label,
  depth,
});

function apply(events: readonly RunEvent[], start: RunViewState = emptyRunView()): RunViewState {
  return events.reduce((state, event) => reduceRunEvent(state, event, 1000), start);
}

describe("reduceRunEvent", () => {
  it("adds a row, moves it through its statuses and keeps its progress", () => {
    const state = apply([
      added("t1", "One"),
      { k: "status", id: "t1", status: "PROCESSING" },
      { k: "progress", id: "t1", progress: 42, message: "halfway" },
    ]);
    expect(state.rows.get("t1")).toMatchObject({
      status: "PROCESSING",
      progress: 42,
      message: "halfway",
      startedAt: 1000,
    });
  });

  it("accumulates streamed text per row rather than replacing it", () => {
    const state = apply([
      added("t1"),
      { k: "text", id: "t1", delta: "Hel" },
      { k: "text", id: "t1", delta: "lo" },
    ]);
    expect(state.rows.get("t1")!.streamText).toBe("Hello");
  });

  it("drops a row the run released", () => {
    const state = apply([added("t1"), { k: "task_removed", id: "t1" }]);
    expect(state.rows.has("t1")).toBe(false);
  });

  it("ignores motion for a row it never heard of", () => {
    const state = apply([{ k: "status", id: "ghost", status: "PROCESSING" }]);
    expect(state.rows.size).toBe(0);
  });

  it("records the run's own end state and clears a prompt nobody can answer", () => {
    const state = apply([
      {
        k: "human_request",
        requestId: "r1",
        kind: "elicit",
        message: "?",
        schema: {},
        data: undefined,
      },
      { k: "run_end", state: "failed", error: "boom", output: undefined },
    ]);
    expect(state).toMatchObject({ state: "failed", error: "boom" });
    expect(state.humanRequest).toBeUndefined();
  });
});

describe("iteration tracking", () => {
  it("keeps per-index state for a small map", () => {
    const state = apply([
      added("map"),
      { k: "iteration", id: "map", index: 0, count: 4, phase: "start" },
      { k: "iteration", id: "map", index: 1, count: 4, phase: "start" },
      { k: "iteration", id: "map", index: 0, count: 4, phase: "complete" },
    ]);
    const map = state.iterations.get("map")!;
    expect(map.count).toBe(4);
    expect([...map.running]).toEqual([1]);
    expect(map.done).toBe(1);
    expect(map.slots!.get(0)).toBe("completed");
  });

  it("stops retaining per-index state above the cap, keeping only what runs", () => {
    const count = FULL_ITERATION_TRACKING_MAX + 1;
    const state = apply([
      added("map"),
      { k: "iteration", id: "map", index: 0, count, phase: "start" },
      { k: "iteration", id: "map", index: 1, count, phase: "start" },
      { k: "iteration", id: "map", index: 0, count, phase: "complete" },
    ]);
    const map = state.iterations.get("map")!;
    expect(map.slots).toBeUndefined();
    expect([...map.running]).toEqual([1]);
    expect(map.done).toBe(1);
  });
});

describe("applyRecord", () => {
  it("ignores an event a reconnect replayed twice", () => {
    let state = applyRecord(emptyRunView(), 1, added("t1"));
    state = applyRecord(state, 1, added("t1"));
    state = applyRecord(state, 2, added("t2"));
    expect([...state.rows.keys()]).toEqual(["t1", "t2"]);
    expect(state.lastSeq).toBe(2);
  });
});

describe("orderedRows", () => {
  it("keeps graph order when asked to", () => {
    const state = apply([added("a"), added("b"), { k: "status", id: "b", status: "COMPLETED" }]);
    expect(orderedRows(state, false).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("sorts roots by status but never separates a child from its parent", () => {
    const state = apply([
      added("a"),
      added("a-child", "child", 1),
      added("b"),
      { k: "status", id: "b", status: "COMPLETED" },
    ]);
    expect(orderedRows(state, true).map((r) => r.id)).toEqual(["b", "a", "a-child"]);
  });
});

describe("filterCommandTree", () => {
  const tree: readonly WebCommandNode[] = [
    {
      path: ["spac"],
      name: "spac",
      description: "Issuer lifecycle",
      args: [],
      options: [],
      children: [
        {
          path: ["spac", "process"],
          name: "process",
          description: "Replay",
          args: [],
          options: [],
          children: [],
        },
        {
          path: ["spac", "report"],
          name: "report",
          description: "Report",
          args: [],
          options: [],
          children: [],
        },
      ],
    },
    {
      path: ["model"],
      name: "model",
      description: "Manage models",
      args: [],
      options: [],
      children: [],
    },
  ];

  it("keeps a branch whose descendant matches, pruning the rest", () => {
    const filtered = filterCommandTree(tree, "replay");
    expect(filtered.map((n) => n.name)).toEqual(["spac"]);
    expect(filtered[0].children.map((n) => n.name)).toEqual(["process"]);
  });

  it("returns everything for an empty query", () => {
    expect(filterCommandTree(tree, "  ")).toHaveLength(2);
  });
});

describe("openPathsFor", () => {
  it("names every ancestor of a deep path", () => {
    expect(openPathsFor(["sec", "spac", "backfill", "despac"])).toEqual([
      "sec",
      "sec.spac",
      "sec.spac.backfill",
    ]);
    expect(openPathsFor(["init"])).toEqual([]);
  });
});
