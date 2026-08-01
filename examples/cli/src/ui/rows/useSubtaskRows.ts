/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask } from "@workglow/task-graph";
import { useEffect, useState } from "react";
import { sortCliTaskLinesForDisplay, startGraphTaskPoll } from "../cliTaskUi";
import type { CliTaskLine, IterationSlotRow } from "../taskGraphCliSubscriptions";
import { subscribeTaskGraphForCli } from "../taskGraphCliSubscriptions";

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
  const [taskInfos, setTaskInfos] = useState<Map<string, CliTaskLine>>(new Map());
  const [overallProgress, setOverallProgress] = useState<number | undefined>(undefined);
  const [iterationSlots, setIterationSlots] = useState<Map<string, IterationSlotRow[]>>(new Map());

  useEffect(() => {
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
  }, [task]);

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
