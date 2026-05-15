/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box } from "ink";
import React from "react";
import { TaskStatusProgressRow } from "../components/TaskStatusProgressRow";
import {
  iterationSlotToTaskStatus,
  sortIterationSlotsForDisplay,
  type CliTaskLine,
  type IterationSlotRow,
} from "../taskGraphCliSubscriptions";
import type { TaskRowProps } from "./pickRenderer";

export function DefaultTaskRow({ line, iterationSlots }: TaskRowProps): React.ReactElement {
  const sortedSlots = iterationSlots ? sortIterationSlotsForDisplay(iterationSlots) : [];
  return (
    <Box key={line.id} flexDirection="column">
      <TaskStatusProgressRow
        type={line.type}
        status={line.status}
        message={line.message}
        barProgress={line.progress ?? 0}
      />
      {sortedSlots.map((slot: IterationSlotRow) => (
        <Box key={`${line.id}-iter-${slot.index}`} flexDirection="column" paddingLeft={2}>
          <TaskStatusProgressRow
            type={`#${slot.index + 1}`}
            status={iterationSlotToTaskStatus(slot.status)}
            message={slot.status === "completed" ? undefined : slot.message}
            barProgress={slot.progress ?? 0}
            suppressProgressBar={slot.status !== "running" || slot.progress === undefined}
          />
        </Box>
      ))}
    </Box>
  );
}

export type { CliTaskLine };
