/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, TaskGraph, TaskIdType, TaskStatus } from "@workglow/task-graph";
import type { Dispatch, SetStateAction } from "react";

export interface CliTaskLine {
  readonly id: string;
  /** Task class type name. Identity for renderer dispatch — never shown to the user. */
  readonly type: string;
  /** What the row displays: the instance's `title` when set, else {@link CliTaskLine.type}. */
  readonly label: string;
  status: string;
  progress?: number;
  message?: string;
}

export interface CliLogLine {
  readonly id: number;
  readonly text: string;
}

/**
 * Two instances of one task class are two different jobs (downloading different
 * files, say), so rows are labelled by the instance's `title` — set per instance
 * via task config — and fall back to the class type name when there is none.
 */
export function cliTaskLabel(task: ITask): string {
  const title = (task as { title?: string }).title;
  if (title !== undefined && title.length > 0) return title;
  return (task as { type?: string }).type ?? "Unknown";
}

/** Per-index row for iterator tasks (MapTask, ReduceTask, …) shown under the parent task line. */
export interface IterationSlotRow {
  readonly index: number;
  status: "pending" | "running" | "completed";
  /** 0–100 from `iteration_progress` (inner cloned graph). */
  progress?: number;
  message?: string;
  /** Live clone for this iteration; render its tasks as ordinary rows. */
  readonly graph?: TaskGraph;
}

/**
 * Map/Reduce children in the CLI: at most `concurrencyLimit` rows — the number
 * the iterator actually has in flight. Prefer currently-running iterations;
 * when fewer than the cap are running (including after the map finishes), fill
 * with the most recently completed so the tree is not an empty parent.
 */
export function visibleIterationSlots(
  slots: readonly IterationSlotRow[],
  concurrencyLimit: number | undefined
): IterationSlotRow[] {
  const running = slots.filter((s) => s.status === "running").sort((a, b) => a.index - b.index);
  const cap =
    concurrencyLimit !== undefined
      ? Math.max(1, Math.min(concurrencyLimit, MAX_RUNNING_ROWS))
      : Math.min(Math.max(running.length, 1), MAX_RUNNING_ROWS);
  if (running.length >= cap) return running.slice(0, cap);

  const completed = slots.filter((s) => s.status === "completed").sort((a, b) => b.index - a.index);
  const out = [...running];
  for (const slot of completed) {
    if (out.length >= cap) break;
    out.push(slot);
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Returns an unsubscribe: a task released with `disown` must not keep its listeners. */
function registerTaskListeners(
  task: ITask,
  taskId: string,
  taskLabel: string,
  setTaskInfos: Dispatch<SetStateAction<Map<string, CliTaskLine>>>,
  appendCompletedLog?: (text: string) => void
): () => void {
  // Each returns `prev` untouched when the row is gone: a task released with
  // `disown` can still emit as it settles, and a fresh Map for a write that
  // lands nowhere is a re-render of the whole task list for nothing.
  const onStatus = (status: TaskStatus): void => {
    setTaskInfos((prev) => {
      const info = prev.get(taskId);
      if (!info) return prev;
      const next = new Map(prev);
      next.set(taskId, { ...info, status });
      if (status === "COMPLETED" && appendCompletedLog) {
        appendCompletedLog(`[COMPLETED] ${taskLabel}`);
      }
      return next;
    });
  };

  const onProgress = (progress: number | undefined, message?: string): void => {
    setTaskInfos((prev) => {
      const info = prev.get(taskId);
      if (!info) return prev;
      const next = new Map(prev);
      next.set(taskId, { ...info, progress, message });
      return next;
    });
  };

  task.events.on("status", onStatus);
  task.events.on("progress", onProgress);

  return () => {
    task.events.off("status", onStatus);
    task.events.off("progress", onProgress);
  };
}

/**
 * Above this iteration count we stop retaining a per-index slot array and track
 * only the currently-running iterations. A `.forEach()` over a worklist that can
 * be hundreds of thousands (or millions) of items long would otherwise (a)
 * allocate an N-length array and (b) copy it on every iteration event — O(N) per
 * event, O(N²) over the run — freezing the render thread. The parent task row
 * already shows overall progress and a "Map X/N" message (emitted by the
 * iterator's aggregate progress), so retaining completed/pending rows for huge
 * loops buys nothing. Small loops keep the full completed→running→pending view.
 */
export const FULL_SLOT_TRACKING_MAX = 200;

/** Hard cap on running rows rendered/retained, independent of concurrency. */
export const MAX_RUNNING_ROWS = 64;

function visibleIterationGraphsOf(task: ITask): Array<{ index: number; graph: TaskGraph }> {
  const getter = (
    task as { getVisibleIterationGraphs?: () => Array<{ index: number; graph: TaskGraph }> }
  ).getVisibleIterationGraphs;
  return typeof getter === "function" ? getter.call(task) : [];
}

/**
 * Overlay live clone graphs from the iterator onto event-driven slots. Nested
 * Maps often fire `iteration_start` before the CLI poll attaches listeners;
 * the iterator keeps those clones so a late row can still render them.
 */
export function mergeLiveIterationGraphs(
  slots: readonly IterationSlotRow[] | undefined,
  task: ITask
): IterationSlotRow[] {
  const live = visibleIterationGraphsOf(task);
  if (live.length === 0) return slots ? [...slots] : [];
  const byIndex = new Map((slots ?? []).map((s) => [s.index, s]));
  for (const { index, graph } of live) {
    const existing = byIndex.get(index);
    byIndex.set(index, {
      index,
      status: existing?.status ?? "running",
      progress: existing?.progress,
      message: existing?.message,
      graph: existing?.graph ?? graph,
    });
  }
  return [...byIndex.values()];
}

export function registerIterationListeners(
  task: ITask,
  taskId: string,
  setIterationSlots: Dispatch<SetStateAction<Map<string, IterationSlotRow[]>>>
): () => void {
  // --- Full per-index tracking (small loops, ≤ FULL_SLOT_TRACKING_MAX). ---
  const onStartFull = (index: number, iterationCount: number, subgraph?: TaskGraph): void => {
    setIterationSlots((prev) => {
      const next = new Map(prev);
      let slots = next.get(taskId);
      if (!slots || slots.length !== iterationCount) {
        slots = Array.from({ length: iterationCount }, (_, i) => ({
          index: i,
          status: "pending" as const,
        }));
      } else {
        slots = [...slots];
      }
      slots[index] = { index, status: "running", graph: subgraph };
      next.set(taskId, slots);
      return next;
    });
  };

  const onCompleteFull = (index: number, iterationCount: number): void => {
    setIterationSlots((prev) => {
      const next = new Map(prev);
      const slots = [...(next.get(taskId) ?? [])];
      while (slots.length < iterationCount) {
        slots.push({ index: slots.length, status: "pending" });
      }
      slots[index] = {
        index,
        status: "completed",
        progress: 100,
        graph: slots[index]?.graph,
      };
      next.set(taskId, slots);
      return next;
    });
  };

  const onProgressFull = (
    index: number,
    iterationCount: number,
    prog: number | undefined,
    message?: string,
    subgraph?: TaskGraph
  ): void => {
    setIterationSlots((prev) => {
      const next = new Map(prev);
      const slots = [...(next.get(taskId) ?? [])];
      while (slots.length < iterationCount) {
        slots.push({ index: slots.length, status: "pending" });
      }
      const cur = slots[index];
      if (cur?.status === "completed") return prev;
      slots[index] = {
        index,
        status: "running",
        progress: prog,
        message,
        graph: subgraph ?? cur?.graph,
      };
      next.set(taskId, slots);
      return next;
    });
  };

  // --- Bounded running-only tracking (huge loops). O(running) per event. ---
  const upsertRunning = (index: number, patch: Partial<IterationSlotRow>): void => {
    setIterationSlots((prev) => {
      const next = new Map(prev);
      const cur = next.get(taskId) ?? [];
      const at = cur.findIndex((s) => s.index === index);
      const existing = at >= 0 ? cur[at] : undefined;
      const row: IterationSlotRow = { ...existing, index, status: "running", ...patch };
      let arr: IterationSlotRow[];
      if (at >= 0) {
        arr = cur.slice();
        arr[at] = row;
      } else if (cur.length >= MAX_RUNNING_ROWS) {
        // Saturated display window: keep the existing rows rather than growing
        // unbounded if concurrency somehow exceeds the cap.
        return prev;
      } else {
        arr = [...cur, row];
      }
      next.set(taskId, arr);
      return next;
    });
  };

  const removeRunning = (index: number): void => {
    setIterationSlots((prev) => {
      const cur = prev.get(taskId);
      if (!cur) return prev;
      const at = cur.findIndex((s) => s.index === index);
      if (at < 0) return prev;
      const next = new Map(prev);
      const arr = cur.slice();
      arr.splice(at, 1);
      next.set(taskId, arr);
      return next;
    });
  };

  const onStart = (index: number, iterationCount: number, subgraph?: TaskGraph): void => {
    if (iterationCount <= FULL_SLOT_TRACKING_MAX) onStartFull(index, iterationCount, subgraph);
    else upsertRunning(index, subgraph ? { graph: subgraph } : {});
  };
  const onComplete = (index: number, iterationCount: number): void => {
    if (iterationCount <= FULL_SLOT_TRACKING_MAX) onCompleteFull(index, iterationCount);
    else removeRunning(index);
  };
  const onIterProgress = (
    index: number,
    iterationCount: number,
    prog: number | undefined,
    message?: string,
    subgraph?: TaskGraph
  ): void => {
    if (iterationCount <= FULL_SLOT_TRACKING_MAX)
      onProgressFull(index, iterationCount, prog, message, subgraph);
    else
      upsertRunning(index, { progress: prog, message, ...(subgraph ? { graph: subgraph } : {}) });
  };

  task.events.on("iteration_start", onStart);
  task.events.on("iteration_complete", onComplete);
  task.events.on("iteration_progress", onIterProgress);

  const live = visibleIterationGraphsOf(task);
  if (live.length > 0) {
    setIterationSlots((prev) => {
      const next = new Map(prev);
      const cur = [...(next.get(taskId) ?? [])];
      for (const { index, graph } of live) {
        const at = cur.findIndex((s) => s.index === index);
        const existing = at >= 0 ? cur[at] : undefined;
        const row: IterationSlotRow = {
          index,
          status: existing?.status ?? "running",
          progress: existing?.progress,
          message: existing?.message,
          graph: existing?.graph ?? graph,
        };
        if (at >= 0) cur[at] = row;
        else cur.push(row);
      }
      next.set(taskId, cur);
      return next;
    });
  }

  return () => {
    task.events.off("iteration_start", onStart);
    task.events.off("iteration_complete", onComplete);
    task.events.off("iteration_progress", onIterProgress);
  };
}

/**
 * Subscribes to per-task status/progress and aggregate graph progress for a {@link TaskGraph}.
 * Handles tasks added mid-run via `task_added`.
 */
export function subscribeTaskGraphForCli(
  graph: TaskGraph,
  setTaskInfos: Dispatch<SetStateAction<Map<string, CliTaskLine>>>,
  setCompletedLogs: Dispatch<SetStateAction<CliLogLine[]>> | undefined,
  setOverallProgress: Dispatch<SetStateAction<number | undefined>>,
  setIterationSlots?: Dispatch<SetStateAction<Map<string, IterationSlotRow[]>>>
): () => void {
  let logCounter = 0;

  const appendCompletedLog =
    setCompletedLogs !== undefined
      ? (text: string): void => {
          const id = logCounter++;
          setCompletedLogs((logs) => [...logs, { id, text }]);
        }
      : undefined;

  const initial = new Map<string, CliTaskLine>();
  for (const task of graph.getTasks()) {
    const taskId = String(task.id);
    const taskType = (task as { type?: string }).type ?? "Unknown";
    initial.set(taskId, {
      id: taskId,
      type: taskType,
      label: cliTaskLabel(task),
      status: "PENDING",
    });
  }
  setTaskInfos(initial);

  // Keyed by task id, holding that task's unsubscribes. The `disown` support
  // means the same instance can be owned, released, and owned again once per
  // job; without dropping its listeners on release, re-wiring would stack a new
  // pair on every cycle and the loop would retain listeners without bound.
  const wired = new Map<string, Array<() => void>>();

  const wire = (task: ITask): void => {
    const taskId = String(task.id);
    if (wired.has(taskId)) return;
    const unsubs: Array<() => void> = [];
    wired.set(taskId, unsubs);
    const taskType = (task as { type?: string }).type ?? "Unknown";
    const taskLabel = cliTaskLabel(task);

    setTaskInfos((prev) => {
      if (prev.has(taskId)) return prev;
      const next = new Map(prev);
      next.set(taskId, { id: taskId, type: taskType, label: taskLabel, status: "PENDING" });
      return next;
    });

    unsubs.push(registerTaskListeners(task, taskId, taskLabel, setTaskInfos, appendCompletedLog));
    if (setIterationSlots) {
      unsubs.push(registerIterationListeners(task, taskId, setIterationSlots));
    }
  };

  for (const task of graph.getTasks()) {
    wire(task);
  }

  const onTaskAdded = (taskId: TaskIdType): void => {
    const t = graph.getTask(taskId);
    if (t) wire(t);
  };

  // A task released with `context.disown` is gone from the graph, so its row is
  // stale — drop it, detach its listeners, and un-wire the id so the same task
  // owned again later (a reused node re-registered per batch) gets a fresh row
  // and a fresh single subscription rather than being silently skipped by the
  // `wired` guard.
  const onTaskRemoved = (taskId: TaskIdType): void => {
    const id = String(taskId);
    const unsubs = wired.get(id);
    if (unsubs) {
      for (const u of unsubs) {
        u();
      }
      wired.delete(id);
    }
    setTaskInfos((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setIterationSlots?.((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const onGraphProgress = (progress: number | undefined): void => {
    setOverallProgress(progress);
  };

  const onGraphStart = (): void => {
    setOverallProgress(0);
  };

  graph.on("task_added", onTaskAdded);
  graph.on("task_removed", onTaskRemoved);
  graph.on("graph_progress", onGraphProgress);
  graph.on("start", onGraphStart);

  return () => {
    for (const unsubs of wired.values()) {
      for (const u of unsubs) {
        u();
      }
    }
    wired.clear();
    graph.off("task_added", onTaskAdded);
    graph.off("task_removed", onTaskRemoved);
    graph.off("graph_progress", onGraphProgress);
    graph.off("start", onGraphStart);
  };
}
