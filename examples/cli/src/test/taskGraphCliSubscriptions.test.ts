/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, TaskOutput } from "@workglow/task-graph";
import { Task, TaskGraph } from "@workglow/task-graph";
import { EventEmitter } from "@workglow/util";
import { describe, expect, it } from "vitest";
import type { CliTaskLine, IterationSlotRow } from "../ui/taskGraphCliSubscriptions";
import {
  FULL_SLOT_TRACKING_MAX,
  MAX_RUNNING_ROWS,
  mergeLiveIterationGraphs,
  registerIterationListeners,
  subscribeTaskGraphForCli,
  visibleIterationSlots,
} from "../ui/taskGraphCliSubscriptions";

// Minimal task stub: registerIterationListeners only touches `task.events`.
function makeTask(): { events: EventEmitter<Record<string, (...args: never[]) => void>> } {
  return { events: new EventEmitter() };
}

// Drives a React-style setState — value or updater, as the real Dispatch accepts
// — against a local Map so we can assert the retained state after emitting events.
function makeSink<V>() {
  let state = new Map<string, V>();
  const setter = (updater: Map<string, V> | ((prev: Map<string, V>) => Map<string, V>)) => {
    state = typeof updater === "function" ? updater(state) : updater;
  };
  return { setter, get: () => state };
}

describe("visibleIterationSlots", () => {
  it("shows only running slots, capped at concurrencyLimit", () => {
    const slots: IterationSlotRow[] = [
      { index: 0, status: "completed" },
      { index: 1, status: "running" },
      { index: 2, status: "running" },
      { index: 3, status: "running" },
      { index: 4, status: "pending" },
    ];
    const visible = visibleIterationSlots(slots, 2);
    expect(visible).toHaveLength(2);
    expect(visible.map((s) => s.index)).toEqual([1, 2]);
    expect(visible.every((s) => s.status === "running")).toBe(true);
  });

  it("fills the cap with the most recently completed slots when none are running", () => {
    const slots: IterationSlotRow[] = [
      { index: 0, status: "completed" },
      { index: 1, status: "completed" },
      { index: 2, status: "completed" },
      { index: 3, status: "pending" },
    ];
    expect(visibleIterationSlots(slots, 1).map((s) => s.index)).toEqual([2]);
    expect(visibleIterationSlots(slots, 2).map((s) => s.index)).toEqual([1, 2]);
  });

  it("shows every running slot when concurrencyLimit is unset, up to the render cap", () => {
    const slots: IterationSlotRow[] = Array.from({ length: 5 }, (_, i) => ({
      index: i,
      status: "running" as const,
    }));
    expect(visibleIterationSlots(slots, undefined)).toHaveLength(5);
  });
});

describe("registerIterationListeners", () => {
  it("keeps full completed/running/pending slots for small loops", () => {
    const task = makeTask();
    const sink = makeSink<IterationSlotRow[]>();
    registerIterationListeners(task as unknown as ITask, "t1", sink.setter as never);

    const N = 5;
    task.events.emit("iteration_start", 2 as never, N as never);
    task.events.emit("iteration_progress", 2 as never, N as never, 40 as never);

    let slots = sink.get().get("t1")!;
    expect(slots).toHaveLength(N); // full per-index array
    expect(slots[2]).toMatchObject({ index: 2, status: "running", progress: 40 });
    expect(slots[0].status).toBe("pending");

    task.events.emit("iteration_complete", 2 as never, N as never);
    slots = sink.get().get("t1")!;
    expect(slots[2]).toMatchObject({ index: 2, status: "completed" });
  });

  it("retains the cloned subgraph from iteration_start so the row can render live tasks", () => {
    const task = makeTask();
    const sink = makeSink<IterationSlotRow[]>();
    registerIterationListeners(task as unknown as ITask, "t1", sink.setter as never);

    const graph = new TaskGraph();
    task.events.emit("iteration_start", 0 as never, 3 as never, graph as never);

    const slots = sink.get().get("t1")!;
    expect(slots[0]?.graph).toBe(graph);

    task.events.emit("iteration_complete", 0 as never, 3 as never);
    expect(sink.get().get("t1")![0]?.graph).toBe(graph);
  });

  it("picks up a clone graph when listeners attach after iteration_start", () => {
    const task = makeTask();
    const graph = new TaskGraph();
    (
      task as unknown as {
        getVisibleIterationGraphs: () => Array<{ index: number; graph: TaskGraph }>;
      }
    ).getVisibleIterationGraphs = () => [{ index: 0, graph }];

    const sink = makeSink<IterationSlotRow[]>();
    registerIterationListeners(task as unknown as ITask, "late", sink.setter as never);

    const slots = sink.get().get("late") ?? [];
    expect(slots.some((s) => s.graph === graph)).toBe(true);
  });

  it("fills empty slots from the iterator's live clone graphs", () => {
    const graph = new TaskGraph();
    const task = {
      getVisibleIterationGraphs: () => [{ index: 2, graph }],
    } as unknown as ITask;
    const merged = mergeLiveIterationGraphs(undefined, task);
    expect(merged).toEqual([{ index: 2, status: "running", graph }]);
  });

  it("attaches the clone graph from a later progress event if start was missed", () => {
    const task = makeTask();
    const sink = makeSink<IterationSlotRow[]>();
    registerIterationListeners(task as unknown as ITask, "t1", sink.setter as never);

    const graph = new TaskGraph();
    task.events.emit(
      "iteration_progress",
      0 as never,
      3 as never,
      40 as never,
      "working" as never,
      graph as never
    );

    expect(sink.get().get("t1")![0]?.graph).toBe(graph);
  });

  it("tracks only running iterations (bounded) for huge loops", () => {
    const task = makeTask();
    const sink = makeSink<IterationSlotRow[]>();
    registerIterationListeners(task as unknown as ITask, "big", sink.setter as never);

    const N = FULL_SLOT_TRACKING_MAX * 5000; // way past the full-tracking threshold
    // Start more concurrent iterations than the render cap allows.
    for (let i = 0; i < MAX_RUNNING_ROWS + 20; i++) {
      task.events.emit("iteration_start", i as never, N as never);
    }
    let slots = sink.get().get("big")!;
    // Never allocates an N-length array; bounded to the running-row cap.
    expect(slots.length).toBe(MAX_RUNNING_ROWS);
    expect(slots.every((s) => s.status === "running")).toBe(true);

    // Completing a running iteration frees its slot (does not accumulate).
    task.events.emit("iteration_complete", 0 as never, N as never);
    task.events.emit("iteration_complete", 1 as never, N as never);
    slots = sink.get().get("big")!;
    expect(slots.length).toBe(MAX_RUNNING_ROWS - 2);
    expect(slots.some((s) => s.index === 0)).toBe(false);
  });

  it("updates progress in place for a running huge-loop iteration", () => {
    const task = makeTask();
    const sink = makeSink<IterationSlotRow[]>();
    registerIterationListeners(task as unknown as ITask, "big", sink.setter as never);

    const N = 1_000_000;
    task.events.emit("iteration_start", 42 as never, N as never);
    task.events.emit("iteration_progress", 42 as never, N as never, 70 as never, "half" as never);

    const slots = sink.get().get("big")!;
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ index: 42, status: "running", progress: 70, message: "half" });
  });
});

describe("subscribeTaskGraphForCli", () => {
  class Noop extends Task {
    public static override readonly type = "CliSubNoopTask";
    public static override readonly title = "Noop";
    override async execute(): Promise<TaskOutput> {
      return {};
    }
  }

  // The point of `disown` is bounding retention, so the UI that follows it must
  // not itself accumulate: an own/run/disown/own cycle over N jobs on one reused
  // task instance would otherwise stack a status+progress pair per cycle.
  it("drops a removed task's listeners so re-owning does not stack them", () => {
    const graph = new TaskGraph();
    const infos = makeSink<CliTaskLine>();
    const slots = makeSink<IterationSlotRow[]>();

    const unsubscribe = subscribeTaskGraphForCli(
      graph,
      infos.setter as never,
      undefined,
      () => {},
      slots.setter as never
    );

    const task = new Noop();
    const id = String(task.id);

    for (let i = 0; i < 5; i++) {
      graph.addTask(task);
      expect(infos.get().has(id)).toBe(true);
      // Exactly one subscription per event, however many cycles have run.
      expect(task.events.listenerCount("status")).toBe(1);
      expect(task.events.listenerCount("progress")).toBe(1);
      expect(task.events.listenerCount("iteration_start")).toBe(1);

      graph.removeTask(task.id);
      expect(infos.get().has(id)).toBe(false);
      for (const ev of [
        "status",
        "progress",
        "iteration_start",
        "iteration_complete",
        "iteration_progress",
      ] as const) {
        expect(task.events.listenerCount(ev)).toBe(0);
      }
    }

    // Inert, not merely detached: a late event writes nothing back.
    task.events.emit("status", "COMPLETED" as never);
    task.events.emit("iteration_start", 0 as never, 3 as never);
    expect(infos.get().has(id)).toBe(false);
    expect(slots.get().has(id)).toBe(false);

    unsubscribe();
  });

  it("clears a removed task's retained iteration slots", () => {
    const graph = new TaskGraph();
    const infos = makeSink<CliTaskLine>();
    const slots = makeSink<IterationSlotRow[]>();

    const unsubscribe = subscribeTaskGraphForCli(
      graph,
      infos.setter as never,
      undefined,
      () => {},
      slots.setter as never
    );

    const task = new Noop();
    const id = String(task.id);
    graph.addTask(task);
    task.events.emit("iteration_start", 0 as never, 3 as never);
    expect(slots.get().has(id)).toBe(true);

    graph.removeTask(task.id);
    expect(slots.get().has(id)).toBe(false);

    unsubscribe();
  });

  // `useSubtaskRows` points this same subscription at a task's subGraph, and
  // that graph is cleared task-by-task by `regenerateGraph()` between runs —
  // a removal path that never goes through `disown`.
  it("detaches listeners when a subgraph is cleared by regenerateGraph", () => {
    const owner = new Noop();
    const children = [new Noop(), new Noop()];
    for (const c of children) owner.subGraph.addTask(c);

    const infos = makeSink<CliTaskLine>();
    const slots = makeSink<IterationSlotRow[]>();
    const unsubscribe = subscribeTaskGraphForCli(
      owner.subGraph,
      infos.setter as never,
      undefined,
      () => {},
      slots.setter as never
    );
    expect(infos.get().size).toBe(2);

    owner.regenerateGraph();

    expect(infos.get().size).toBe(0);
    for (const c of children) {
      expect(c.events.listenerCount("status")).toBe(0);
      expect(c.events.listenerCount("progress")).toBe(0);
      expect(c.events.listenerCount("iteration_start")).toBe(0);
    }

    unsubscribe();
  });

  it("detaches every task's listeners on unsubscribe", () => {
    const graph = new TaskGraph();
    const infos = makeSink<CliTaskLine>();
    const slots = makeSink<IterationSlotRow[]>();

    const first = new Noop();
    const second = new Noop();
    graph.addTask(first);

    const unsubscribe = subscribeTaskGraphForCli(
      graph,
      infos.setter as never,
      undefined,
      () => {},
      slots.setter as never
    );
    // Wired at subscribe time and mid-run alike.
    graph.addTask(second);
    expect(first.events.listenerCount("status")).toBe(1);
    expect(second.events.listenerCount("status")).toBe(1);

    unsubscribe();

    for (const t of [first, second]) {
      expect(t.events.listenerCount("status")).toBe(0);
      expect(t.events.listenerCount("progress")).toBe(0);
      expect(t.events.listenerCount("iteration_start")).toBe(0);
    }
  });
});
