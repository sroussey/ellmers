/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";
import { ProgressBar } from "./ProgressBar";
import { TaskDetailColumn } from "./TaskDetailColumn";

/**
 * A progress row for something that is not a task — the run as a whole, or one
 * subgraph — laid out in the same three columns {@link TaskStatusProgressRow}
 * uses so its bar lands in the same place as every bar beneath it.
 *
 * The label has to grow for that to happen. Left to `justifyContent` alone the
 * three children space themselves evenly and the bar drifts to the middle of
 * the terminal, which on a wide window puts it nowhere near the column it is
 * supposed to head.
 */
export function AggregateProgressRow({
  label,
  progress,
  emphasis = false,
}: {
  readonly label: string;
  readonly progress: number | undefined;
  /** True for the run's own bar, which outranks the rows below it. */
  readonly emphasis?: boolean;
}): React.ReactElement {
  const theme = useCliTheme();
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box flexGrow={1} minWidth={0} overflow="hidden">
        <Text color={theme.level === "advanced" ? theme.fg : undefined} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        <ProgressBar progress={progress} emphasis={emphasis} />
      </Box>
      <TaskDetailColumn progress={progress} durationMs={undefined} running={true} />
    </Box>
  );
}
