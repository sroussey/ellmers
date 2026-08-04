/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, TaskGraph, type ITask } from "@workglow/task-graph";
import { EventEmitter } from "@workglow/util";
import { describe, expect, it } from "vitest";
import {
  FULL_SLOT_TRACKING_MAX,
  MAX_RUNNING_ROWS,
  registerIterationListeners,
  subscribeTaskGraphForCli,
  type CliTaskLine,
  type IterationSlotRow,
} from "../ui/taskGraphCliSubscriptions";

// Minimal task stub: registerIterationListeners only touches `task.events`.
function makeTask(): { events: EventEmitter<Record<string, (...args: never[]) => void>> } {
  return { events: new EventEmitter() };
}

// Drives the React-style setState updater against a local Map so we can assert
// the retained slot state after emitting iterator events.
function makeSink() {
  let state = new Map<string, IterationSlotRow[]>();
  const setter = (
    updater: (prev: Map<string, IterationSlotRow[]>) => Map<string, IterationSlotRow[]>
  ) => {
    state = updater(state);
  };
  return { setter, get: () => state };
}

// Same idea for the task-row map, which `subscribeTaskGraphForCli` also seeds
// with a plain value (not only updater functions).
function makeInfoSink() {
  let state = new Map<string, CliTaskLine>();
  const setter = (
    update:
      Map<string, CliTaskLine> | ((prev: Map<string, CliTaskLine>) => Map<string, CliTaskLine>)
  ) => {
    state = typeof update === "function" ? update(state) : update;
  };
  return { setter, get: () => state };
}

const SCHEMA = { type: "object", properties: {} } as never;

class DisownableTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "DisownableTask";
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

describe("subscribeTaskGraphForCli task lifecycle", () => {
  it("disposes a removed task's listeners", () => {
    const graph = new TaskGraph();
    const task = new DisownableTask();
    graph.addTask(task as never);

    const infos = makeInfoSink();
    const slots = makeSink();
    const unsubscribe = subscribeTaskGraphForCli(
      graph,
      infos.setter as never,
      undefined,
      () => {},
      slots.setter as never
    );

    const id = String(task.id);
    expect(infos.get().has(id)).toBe(true);
    expect(task.events.listenerCount("status")).toBe(1);
    expect(task.events.listenerCount("iteration_start")).toBe(1);

    task.events.emit("iteration_start", 0, 3);
    expect(slots.get().get(id)).toHaveLength(3);

    // What `context.disown` does to the graph.
    graph.removeTask(task.id);

    expect(infos.get().has(id)).toBe(false);
    // Not just the row: the slot key must go too, or the Map grows unbounded.
    expect(slots.get().has(id)).toBe(false);
    // The listeners are the strong reference that survives `disown` — they must
    // be off the task, not merely detached from the graph.
    expect(task.events.listenerCount("status")).toBe(0);
    expect(task.events.listenerCount("progress")).toBe(0);
    expect(task.events.listenerCount("iteration_start")).toBe(0);
    expect(task.events.listenerCount("iteration_complete")).toBe(0);
    expect(task.events.listenerCount("iteration_progress")).toBe(0);

    // Inert, not merely unreferenced: a late event writes nothing back.
    task.events.emit("iteration_start", 1, 3);
    task.events.emit("status", "COMPLETED");
    expect(slots.get().has(id)).toBe(false);
    expect(infos.get().has(id)).toBe(false);

    unsubscribe();
  });

  it("re-wires a task owned again after being disowned", () => {
    const graph = new TaskGraph();
    const task = new DisownableTask();
    graph.addTask(task as never);

    const infos = makeInfoSink();
    const unsubscribe = subscribeTaskGraphForCli(graph, infos.setter as never, undefined, () => {});

    const id = String(task.id);
    graph.removeTask(task.id);
    expect(infos.get().has(id)).toBe(false);

    graph.addTask(task as never);
    expect(infos.get().has(id)).toBe(true);
    expect(task.events.listenerCount("status")).toBe(1);

    unsubscribe();
    expect(task.events.listenerCount("status")).toBe(0);
  });
});

describe("registerIterationListeners", () => {
  it("keeps full completed/running/pending slots for small loops", () => {
    const task = makeTask();
    const sink = makeSink();
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

  it("tracks only running iterations (bounded) for huge loops", () => {
    const task = makeTask();
    const sink = makeSink();
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
    const sink = makeSink();
    registerIterationListeners(task as unknown as ITask, "big", sink.setter as never);

    const N = 1_000_000;
    task.events.emit("iteration_start", 42 as never, N as never);
    task.events.emit("iteration_progress", 42 as never, N as never, 70 as never, "half" as never);

    const slots = sink.get().get("big")!;
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ index: 42, status: "running", progress: 70, message: "half" });
  });
});
