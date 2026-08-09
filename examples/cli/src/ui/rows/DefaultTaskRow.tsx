/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsage } from "@workglow/ai";
import { Box, Text } from "ink";
import React from "react";
import { TaskStatusProgressRow } from "../components/TaskStatusProgressRow";
import {
  iterationSlotToTaskStatus,
  sortIterationSlotsForDisplay,
  type CliTaskLine,
  type IterationSlotRow,
} from "../taskGraphCliSubscriptions";
import type { TaskRowProps } from "./pickRenderer";
import { isRedundantSubgraph, SubtaskRows } from "./SubtaskRows";
import { useSubtaskRows } from "./useSubtaskRows";
import { useTaskUsage } from "./useTaskUsage";

export function DefaultTaskRow({ task, line, iterationSlots }: TaskRowProps): React.ReactElement {
  const sortedSlots = iterationSlots ? sortIterationSlotsForDisplay(iterationSlots) : [];
  const subtasks = useSubtaskRows(task);
  const usage = useTaskUsage(task);
  return (
    <Box key={line.id} flexDirection="column">
      <TaskStatusProgressRow
        label={line.label}
        status={line.status}
        message={line.message}
        barProgress={line.progress ?? 0}
      />
      {formatUsage(usage, "directional") ? (
        <Text dimColor> {formatUsage(usage, "directional")}</Text>
      ) : null}
      {sortedSlots.map((slot: IterationSlotRow) => (
        <Box key={`${line.id}-iter-${slot.index}`} flexDirection="column" paddingLeft={2}>
          <TaskStatusProgressRow
            label={`#${slot.index + 1}`}
            status={iterationSlotToTaskStatus(slot.status)}
            message={slot.status === "completed" ? undefined : slot.message}
            barProgress={slot.progress ?? 0}
            suppressProgressBar={slot.status !== "running" || slot.progress === undefined}
          />
        </Box>
      ))}
      {!isRedundantSubgraph(subtasks.rows, line.type) && (
        <SubtaskRows
          rows={subtasks.rows}
          tasks={subtasks.tasks}
          iterationSlots={subtasks.iterationSlots}
        />
      )}
    </Box>
  );
}

export type { CliTaskLine };
