/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, TaskGraph } from "@workglow/task-graph";
import { useEffect, useState } from "react";
import { sortCliTaskLinesForDisplay, startGraphTaskPoll } from "../cliTaskUi";
import type { CliTaskLine, IterationSlotRow } from "../taskGraphCliSubscriptions";
import { cliTaskLabel, subscribeTaskGraphForCli } from "../taskGraphCliSubscriptions";

export interface SubtaskRowsState {
  /** Owned subtasks in display order (completed → running → pending, then graph order). */
  readonly rows: readonly CliTaskLine[];
  /**
   * The live task behind each row, keyed by row id. A row that owns tasks of its
   * own — an owned workflow wrapping a whole pipeline, say — needs its instance
   * so the renderer can recurse into that subgraph instead of stopping at the
   * wrapper row.
   */
  readonly tasks: ReadonlyMap<string, ITask>;
  /** Aggregate progress of the subgraph, once it reports any. */
  readonly overallProgress: number | undefined;
  readonly iterationSlots: ReadonlyMap<string, IterationSlotRow[]>;
}

/** A task in one of these states will never gain children, so stop waiting for them. */
function isSettled(status: string): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "ABORTED";
}

const EMPTY_SUBTASK_ROWS: SubtaskRowsState = {
  rows: [],
  tasks: new Map(),
  overallProgress: undefined,
  iterationSlots: new Map(),
};

/**
 * MapTask / ReduceTask / ForEachTask: the subgraph is the idle template, not the
 * live iteration clones. Those clones arrive via `iteration_start` and are
 * rendered as ordinary task rows.
 */
export function isIteratorTask(task: ITask): boolean {
  return typeof (task as { analyzeIterationInput?: unknown }).analyzeIterationInput === "function";
}

function concurrencyLimitOf(task: ITask): number | undefined {
  const limit = (task as { concurrencyLimit?: number }).concurrencyLimit;
  return typeof limit === "number" && limit >= 1 ? limit : undefined;
}

export { concurrencyLimitOf };

function taskToCliLine(task: ITask): CliTaskLine {
  return {
    id: String(task.id),
    type: (task as { type?: string }).type ?? "Unknown",
    label: cliTaskLabel(task),
    status: String(task.status),
  };
}

function linesFromTasks(tasks: readonly ITask[]): Map<string, CliTaskLine> {
  return new Map(tasks.map((t) => [String(t.id), taskToCliLine(t)]));
}

/**
 * Subscribe to an already-populated graph (a Map iteration clone) the same way
 * {@link useSubtaskRows} subscribes to a task's owned subgraph.
 */
export function useGraphTaskRows(graph: TaskGraph): SubtaskRowsState {
  const children = graph.getTasks();
  const [taskInfos, setTaskInfos] = useState<Map<string, CliTaskLine>>(() => linesFromTasks(children));
  const [overallProgress, setOverallProgress] = useState<number | undefined>(undefined);
  const [iterationSlots, setIterationSlots] = useState<Map<string, IterationSlotRow[]>>(new Map());

  useEffect(() => {
    const unsub = subscribeTaskGraphForCli(
      graph,
      setTaskInfos,
      undefined,
      setOverallProgress,
      setIterationSlots
    );
    const stopPoll = startGraphTaskPoll(graph, setTaskInfos);
    return () => {
      unsub();
      stopPoll();
    };
  }, [graph]);

  const order = new Map(children.map((t, i) => [String(t.id), i]));
  const tasks = new Map(children.map((t) => [String(t.id), t]));
  const rowsSource = taskInfos.size > 0 ? Array.from(taskInfos.values()) : children.map(taskToCliLine);

  return {
    rows: sortCliTaskLinesForDisplay(rowsSource, order),
    tasks,
    overallProgress,
    iterationSlots,
  };
}

/**
 * Tracks the tasks a running task owns via `context.own()`.
 *
 * A task's `subGraph` is usually empty when the row first mounts — children are
 * added as `execute()` reaches them — and `Task` only emits `regenerate` on its
 * own event bus when that happens, which no graph-level listener sees. So the
 * subgraph is attached lazily: poll `hasChildren()` until it flips, then
 * subscribe once with the same {@link subscribeTaskGraphForCli} the top-level
 * graph uses.
 */
export function useSubtaskRows(task: ITask): SubtaskRowsState {
  const skipTemplate = isIteratorTask(task);
  const [taskInfos, setTaskInfos] = useState<Map<string, CliTaskLine>>(new Map());
  const [overallProgress, setOverallProgress] = useState<number | undefined>(undefined);
  const [iterationSlots, setIterationSlots] = useState<Map<string, IterationSlotRow[]>>(new Map());

  useEffect(() => {
    if (skipTemplate) return;
    let unsub: (() => void) | undefined;
    let stopPoll: (() => void) | undefined;
    let attachInterval: ReturnType<typeof setInterval> | undefined;

    const tryAttach = (): void => {
      if (unsub) return;
      if (!task.hasChildren() || !task.subGraph) {
        // Recursion multiplies these pollers across the tree, and a leaf that
        // finished childless would otherwise keep waking up for the whole run.
        if (isSettled(task.status) && attachInterval !== undefined) clearInterval(attachInterval);
        return;
      }
      unsub = subscribeTaskGraphForCli(
        task.subGraph,
        setTaskInfos,
        undefined,
        setOverallProgress,
        setIterationSlots
      );
      stopPoll = startGraphTaskPoll(task.subGraph, setTaskInfos);
      // The subgraph is created once and kept, so nothing is left to wait for.
      // Every row in a graph runs this hook — leaving the timer armed would cost
      // one wake-up per childless task for the life of the run.
      if (attachInterval !== undefined) clearInterval(attachInterval);
    };

    tryAttach();
    if (!unsub) attachInterval = setInterval(tryAttach, 150);

    return () => {
      if (attachInterval !== undefined) clearInterval(attachInterval);
      unsub?.();
      stopPoll?.();
    };
  }, [task, skipTemplate]);

  if (skipTemplate) return EMPTY_SUBTASK_ROWS;

  const children = task.hasChildren() && task.subGraph ? task.subGraph.getTasks() : [];
  const order = new Map(children.map((t, i) => [String(t.id), i]));
  const tasks = new Map(children.map((t) => [String(t.id), t]));

  return {
    rows: sortCliTaskLinesForDisplay(Array.from(taskInfos.values()), order),
    tasks,
    overallProgress,
    iterationSlots,
  };
}
