/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, TaskGraph } from "@workglow/task-graph";
import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";
import { ProgressBar } from "../components/ProgressBar";
import { TaskDetailColumn } from "../components/TaskDetailColumn";
import { TaskErrorDetail } from "../components/TaskErrorDetail";
import { TaskStatusProgressRow } from "../components/TaskStatusProgressRow";
import { iterationSummaryLine } from "../model/runRowModel";
import type { CliTaskLine, IterationSlotRow } from "../taskGraphCliSubscriptions";
import { mergeLiveIterationGraphs, visibleIterationSlots } from "../taskGraphCliSubscriptions";
import { settledTaskDurationMs } from "./taskDuration";
import {
  concurrencyLimitOf,
  isIteratorTask,
  useGraphTaskRows,
  useSubtaskRows,
} from "./useSubtaskRows";
import { useTaskUsageLine } from "./useTaskUsageLine";

/**
 * A long-running task can own hundreds of subtasks (one generation per eval
 * fixture, say). {@link sortCliTaskLinesForDisplay} puts completed rows first,
 * so the tail is the live work — keep that and summarize the rest rather than
 * scrolling the active row off the terminal.
 */
const MAX_VISIBLE_SUBTASKS = 6;

/**
 * How many levels of owned subgraph to render beneath a task row. A task that
 * owns a workflow produces a wrapper row whose own children are the real work,
 * so one level is never enough — stopping at the wrapper shows "Workflow" and
 * hides the pipeline inside it. Deeper than this and the breadth cap multiplies
 * into more rows (and more attach pollers) than a terminal can use.
 */
const MAX_SUBTASK_DEPTH = 2;

/**
 * Live Map/Reduce iterations: at most `concurrencyLimit` running clones, each
 * rendered as a normal task tree (title + owned subtasks), not `#1`/`#2`.
 */
export function IterationTaskRows({
  task,
  slots,
  concurrencyLimit,
}: {
  readonly task: ITask;
  readonly slots: readonly IterationSlotRow[] | undefined;
  readonly concurrencyLimit: number | undefined;
}): React.ReactElement | null {
  const merged = mergeLiveIterationGraphs(slots, task);
  const visible = visibleIterationSlots(merged, concurrencyLimit);
  if (visible.length === 0) return null;
  const summary = iterationSummaryLine(merged, visible.length);
  return (
    <Box flexDirection="column">
      {visible.map((slot) =>
        slot.graph ? <IterationGraphRows key={slot.index} graph={slot.graph} /> : null
      )}
      {summary ? <Text dimColor>{`  ${summary}`}</Text> : null}
    </Box>
  );
}

function IterationGraphRows({ graph }: { readonly graph: TaskGraph }): React.ReactElement | null {
  const state = useGraphTaskRows(graph);
  if (state.rows.length === 0) return null;
  return (
    <SubtaskRows rows={state.rows} tasks={state.tasks} iterationSlots={state.iterationSlots} />
  );
}

interface SubtaskRowsProps {
  readonly rows: readonly CliTaskLine[];
  readonly iterationSlots: ReadonlyMap<string, IterationSlotRow[]>;
  /** Live task per row id; enables recursion into rows that own subgraphs. */
  readonly tasks?: ReadonlyMap<string, ITask> | undefined;
  /** Nesting level of this list; recursion stops at {@link MAX_SUBTASK_DEPTH}. */
  readonly depth?: number;
  /** Aggregate subgraph progress; only rendered in `chrome` mode. */
  readonly overallProgress?: number | undefined;
  /**
   * `chrome` adds the "Subtasks" heading and subgraph progress bar — right for
   * the single-task view, where the subgraph is the whole screen. `compact`
   * (the default) just indents the rows under their parent, so a graph of N
   * task rows does not grow N headings.
   */
  readonly variant?: "compact" | "chrome";
}

/**
 * Renders the tasks a task owns (`context.own`) as indented rows beneath it.
 * Shared by {@link DefaultTaskRow} (workflow/graph runs) and `TaskRunApp`
 * (single-task runs) so both views show ownership the same way.
 */
/**
 * One subtask row plus, when that subtask owns tasks of its own, its children
 * indented beneath it. Split out as a component because the subgraph is tracked
 * with a hook, which cannot be called from inside a `map` over a changing list.
 */
function SubtaskRow({
  line,
  task,
  iterationSlots,
  depth,
}: {
  readonly line: CliTaskLine;
  readonly task: ITask | undefined;
  readonly iterationSlots: ReadonlyMap<string, IterationSlotRow[]>;
  readonly depth: number;
}): React.ReactElement {
  if (task === undefined) {
    return (
      <Box flexDirection="column">
        <TaskStatusProgressRow
          label={line.label}
          status={line.status}
          message={line.message}
          barProgress={line.progress}
        />
      </Box>
    );
  }
  return (
    <SubtaskStatusWithUsage task={task} line={line} iterationSlots={iterationSlots} depth={depth} />
  );
}

/** Status + token/cost line for one owned child; isolated so the usage hook is legal. */
function SubtaskStatusWithUsage({
  task,
  line,
  iterationSlots,
  depth,
}: {
  readonly task: ITask;
  readonly line: CliTaskLine;
  readonly iterationSlots: ReadonlyMap<string, IterationSlotRow[]>;
  readonly depth: number;
}): React.ReactElement {
  const slots = iterationSlots.get(line.id);
  const usageLine = useTaskUsageLine(task);
  const iterator = isIteratorTask(task);
  return (
    <Box flexDirection="column">
      <TaskStatusProgressRow
        label={line.label}
        status={line.status}
        message={line.message}
        barProgress={line.progress}
        durationMs={usageLine ? undefined : settledTaskDurationMs(task)}
      />
      {usageLine ? <Text dimColor> {usageLine}</Text> : null}
      <TaskErrorDetail task={task} status={line.status} />
      <IterationTaskRows task={task} slots={slots} concurrencyLimit={concurrencyLimitOf(task)} />
      {depth < MAX_SUBTASK_DEPTH && !iterator && (
        <NestedSubtaskRows task={task} parentType={line.type} depth={depth} />
      )}
    </Box>
  );
}

/** Subscribes to one subtask's own subgraph and renders it a level deeper. */
function NestedSubtaskRows({
  task,
  parentType,
  depth,
}: {
  readonly task: ITask;
  readonly parentType: string;
  readonly depth: number;
}): React.ReactElement | null {
  const nested = useSubtaskRows(task);
  if (nested.rows.length === 0 || isRedundantSubgraph(nested.rows, parentType)) return null;
  return (
    <SubtaskRows
      rows={nested.rows}
      tasks={nested.tasks}
      iterationSlots={nested.iterationSlots}
      depth={depth + 1}
    />
  );
}

export function SubtaskRows({
  rows,
  iterationSlots,
  tasks,
  depth = 0,
  overallProgress,
  variant = "compact",
}: SubtaskRowsProps): React.ReactElement | null {
  const theme = useCliTheme();
  const bodyColor = theme.level === "advanced" ? theme.fg : undefined;
  const showChrome = variant === "chrome";

  if (rows.length === 0 && !(showChrome && overallProgress !== undefined)) return null;

  const hiddenCount = Math.max(0, rows.length - MAX_VISIBLE_SUBTASKS);
  const visible = hiddenCount > 0 ? rows.slice(rows.length - MAX_VISIBLE_SUBTASKS) : rows;

  const body = (
    <Box paddingLeft={2} flexDirection="column">
      {showChrome && overallProgress !== undefined && (
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Text color={bodyColor}>Subgraph</Text>
          <Box flexShrink={0} marginLeft={1}>
            <ProgressBar progress={overallProgress} />
          </Box>
          <TaskDetailColumn progress={overallProgress} durationMs={undefined} running={true} />
        </Box>
      )}
      {hiddenCount > 0 && <Text dimColor>… {hiddenCount} completed</Text>}
      {visible.map((t) => (
        <SubtaskRow
          key={t.id}
          line={t}
          task={tasks?.get(t.id)}
          iterationSlots={iterationSlots}
          depth={depth}
        />
      ))}
    </Box>
  );

  if (!showChrome) return body;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>Subtasks</Text>
      {body}
    </Box>
  );
}

/**
 * A single child of the same type as its parent is the same logical work seen
 * twice (a job-queue mirror, a task that owns a clone of itself), so the row
 * would just be noise.
 */
export function isRedundantSubgraph(rows: readonly CliTaskLine[], parentType: string): boolean {
  return rows.length === 1 && rows[0]?.type === parentType;
}

export { iterationSummaryLine };
