/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraph } from "@workglow/task-graph";
import type { Dispatch, SetStateAction } from "react";
import { adoptPolledProgress, cliTaskShowsProgressBar } from "./model/runRowModel";
import type { CliTaskLine } from "./taskGraphCliSubscriptions";
import { cliTaskLabel } from "./taskGraphCliSubscriptions";

export {
  adoptPolledProgress,
  cliTaskShowsProgressBar,
  cliTaskStatusGlyph,
  cliTaskStatusGlyphColor,
  cliTaskStatusSortOrder,
  sortCliTaskLinesForDisplay,
} from "./model/runRowModel";

/** Optional per-file progress (e.g. {@link ModelDownloadTask}.files). */
export interface TaskFileProgressRow {
  readonly file: string;
  readonly progress: number;
}

/**
 * Polls `task.status` on the runner-owned instance (backup if `emit("status")` is missed).
 * For single-task runs, {@link TaskRunApp} batches `progress` / `files` on a timer so Ink is not
 * flooded with setState (high-frequency download progress + poll + spinner).
 */
export function startTaskInstancePoll(
  getTask: () => { status?: string } | undefined,
  setStatus: Dispatch<SetStateAction<string>>
): () => void {
  const id = setInterval(() => {
    const t = getTask();
    if (!t) return;
    if (t.status !== undefined) setStatus(t.status);
  }, 100);
  return () => clearInterval(id);
}

/**
 * Same idea as {@link startTaskInstancePoll} but for every node in a {@link TaskGraph}.
 */
export function startGraphTaskPoll(
  graph: TaskGraph,
  setTaskInfos: Dispatch<SetStateAction<Map<string, CliTaskLine>>>
): () => void {
  const id = setInterval(() => {
    setTaskInfos((prev) => {
      let next: Map<string, CliTaskLine> | undefined;
      for (const task of graph.getTasks()) {
        const taskId = String(task.id);
        const info = prev.get(taskId);
        if (!info) continue;
        const st = task.status;
        // A status event this poll beat to the transition: the row's reported
        // progress belongs to the previous run of a reused instance, not this
        // one, so it cannot vouch for a polled zero.
        const restarted = info.status !== st && cliTaskShowsProgressBar(st);
        const prog = adoptPolledProgress(task.progress, restarted ? undefined : info.progress);
        // Label is re-read, not just carried over: a task instance reused for a
        // sequence of jobs is relabelled per job (`setTitle`), and the row is
        // wired once at `task_added`, so without this the row would keep naming
        // the first job for the life of the run.
        const label = cliTaskLabel(task);
        if (info.status !== st || info.progress !== prog || info.label !== label) {
          if (!next) next = new Map(prev);
          next.set(taskId, { ...info, status: st, progress: prog, label });
        }
      }
      return next ?? prev;
    });
  }, 100);
  return () => clearInterval(id);
}
