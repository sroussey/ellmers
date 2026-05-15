/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, TaskGraph, TaskIdType } from "@workglow/task-graph";
import type { Dispatch, SetStateAction } from "react";

export interface CliTaskLine {
  readonly id: string;
  readonly type: string;
  status: string;
  progress?: number;
  message?: string;
}

export interface CliLogLine {
  readonly id: number;
  readonly text: string;
}

/** Per-index row for iterator tasks (MapTask, ReduceTask, …) shown under the parent task line. */
export interface IterationSlotRow {
  readonly index: number;
  status: "pending" | "running" | "completed";
  /** 0–100 from `iteration_progress` (inner cloned graph). */
  progress?: number;
  message?: string;
}

export function iterationSlotToTaskStatus(slot: IterationSlotRow["status"]): string {
  switch (slot) {
    case "pending":
      return "PENDING";
    case "running":
      return "PROCESSING";
    case "completed":
      return "COMPLETED";
  }
}

/** Same tier order as workflow rows: completed → running → pending; then by iteration index. */
export function sortIterationSlotsForDisplay(
  slots: readonly IterationSlotRow[]
): IterationSlotRow[] {
  const order = (s: IterationSlotRow["status"]): number => {
    switch (s) {
      case "completed":
        return 0;
      case "running":
        return 1;
      case "pending":
        return 2;
    }
  };
  return [...slots].sort((a, b) => {
    const ta = order(a.status);
    const tb = order(b.status);
    if (ta !== tb) return ta - tb;
    return a.index - b.index;
  });
}

function registerTaskListeners(
  task: ITask,
  taskId: string,
  taskType: string,
  setTaskInfos: Dispatch<SetStateAction<Map<string, CliTaskLine>>>,
  appendCompletedLog?: (text: string) => void
): void {
  task.events.on("status", (status: string) => {
    setTaskInfos((prev) => {
      const next = new Map(prev);
      const info = next.get(taskId);
      if (info) {
        next.set(taskId, { ...info, status });
        if (status === "COMPLETED" && appendCompletedLog) {
          appendCompletedLog(`[COMPLETED] ${taskType}`);
        }
      }
      return next;
    });
  });

  task.events.on("progress", (progress: number | undefined, message?: string) => {
    setTaskInfos((prev) => {
      const next = new Map(prev);
      const info = next.get(taskId);
      if (info) {
        next.set(taskId, { ...info, progress, message });
      }
      return next;
    });
  });
}

function registerIterationListeners(
  task: ITask,
  taskId: string,
  setIterationSlots: Dispatch<SetStateAction<Map<string, IterationSlotRow[]>>>
): () => void {
  const onStart = (index: number, iterationCount: number): void => {
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
      slots[index] = { index, status: "running" };
      next.set(taskId, slots);
      return next;
    });
  };

  const onComplete = (index: number, iterationCount: number): void => {
    setIterationSlots((prev) => {
      const next = new Map(prev);
      let slots = [...(next.get(taskId) ?? [])];
      while (slots.length < iterationCount) {
        slots.push({ index: slots.length, status: "pending" });
      }
      slots[index] = { index, status: "completed", progress: 100 };
      next.set(taskId, slots);
      return next;
    });
  };

  const onIterProgress = (
    index: number,
    iterationCount: number,
    prog: number | undefined,
    message?: string
  ): void => {
    setIterationSlots((prev) => {
      const next = new Map(prev);
      let slots = [...(next.get(taskId) ?? [])];
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
      };
      next.set(taskId, slots);
      return next;
    });
  };

  task.events.on("iteration_start", onStart);
  task.events.on("iteration_complete", onComplete);
  task.events.on("iteration_progress", onIterProgress);

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
    initial.set(taskId, { id: taskId, type: taskType, status: "PENDING" });
  }
  setTaskInfos(initial);

  const wired = new Set<string>();
  const iterationUnsubs: Array<() => void> = [];

  const wire = (task: ITask): void => {
    const taskId = String(task.id);
    if (wired.has(taskId)) return;
    wired.add(taskId);
    const taskType = (task as { type?: string }).type ?? "Unknown";

    setTaskInfos((prev) => {
      if (prev.has(taskId)) return prev;
      const next = new Map(prev);
      next.set(taskId, { id: taskId, type: taskType, status: "PENDING" });
      return next;
    });

    registerTaskListeners(task, taskId, taskType, setTaskInfos, appendCompletedLog);
    if (setIterationSlots) {
      iterationUnsubs.push(registerIterationListeners(task, taskId, setIterationSlots));
    }
  };

  for (const task of graph.getTasks()) {
    wire(task);
  }

  const onTaskAdded = (taskId: TaskIdType): void => {
    const t = graph.getTask(taskId);
    if (t) wire(t);
  };

  const onGraphProgress = (progress: number | undefined): void => {
    setOverallProgress(progress);
  };

  const onGraphStart = (): void => {
    setOverallProgress(0);
  };

  graph.on("task_added", onTaskAdded);
  graph.on("graph_progress", onGraphProgress);
  graph.on("start", onGraphStart);

  return () => {
    for (const u of iterationUnsubs) {
      u();
    }
    graph.off("task_added", onTaskAdded);
    graph.off("graph_progress", onGraphProgress);
    graph.off("start", onGraphStart);
  };
}
