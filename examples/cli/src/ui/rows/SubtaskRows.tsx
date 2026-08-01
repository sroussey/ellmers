/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";
import { ProgressBar } from "../components/ProgressBar";
import { TaskStatusProgressRow } from "../components/TaskStatusProgressRow";
import type { CliTaskLine, IterationSlotRow } from "../taskGraphCliSubscriptions";
import {
  iterationSlotToTaskStatus,
  sortIterationSlotsForDisplay,
} from "../taskGraphCliSubscriptions";

/**
 * A long-running task can own hundreds of subtasks (one generation per eval
 * fixture, say). {@link sortCliTaskLinesForDisplay} puts completed rows first,
 * so the tail is the live work — keep that and summarize the rest rather than
 * scrolling the active row off the terminal.
 */
const MAX_VISIBLE_SUBTASKS = 6;

interface SubtaskRowsProps {
  readonly rows: readonly CliTaskLine[];
  readonly iterationSlots: ReadonlyMap<string, IterationSlotRow[]>;
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
export function SubtaskRows({
  rows,
  iterationSlots,
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
          <Text color={bodyColor}>Subgraph: </Text>
          <Box flexShrink={0} marginLeft={1}>
            <ProgressBar progress={overallProgress} />
          </Box>
        </Box>
      )}
      {hiddenCount > 0 && <Text dimColor>… {hiddenCount} completed</Text>}
      {visible.map((t) => {
        const slots = iterationSlots.get(t.id);
        const sortedSlots = slots ? sortIterationSlotsForDisplay(slots) : [];
        return (
          <Box key={t.id} flexDirection="column">
            <TaskStatusProgressRow
              label={t.label}
              status={t.status}
              message={t.message}
              barProgress={t.progress ?? 0}
            />
            {sortedSlots.map((slot) => (
              <Box key={`${t.id}-iter-${slot.index}`} flexDirection="column" paddingLeft={2}>
                <TaskStatusProgressRow
                  label={`#${slot.index + 1}`}
                  status={iterationSlotToTaskStatus(slot.status)}
                  message={slot.status === "completed" ? undefined : slot.message}
                  barProgress={slot.progress ?? 0}
                  suppressProgressBar={slot.status !== "running" || slot.progress === undefined}
                />
              </Box>
            ))}
          </Box>
        );
      })}
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
