/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";
import { formatCliDuration } from "../formatCliDuration";

/** Column width holds the widest value either state produces (`847ms`, `100%`). */
export const TASK_DETAIL_COLUMN_WIDTH = 6;

/**
 * The one number at the end of a task row: how far along it is while it runs,
 * and how long it took once it settles. Two states of one column rather than
 * two columns, because only one of them is ever true, and a fixed width keeps
 * the values aligned down the run.
 */
export function taskDetailText(
  progress: number | undefined,
  durationMs: number | undefined,
  running: boolean
): string {
  if (running) {
    if (progress === undefined) return "";
    return `${Math.round(Math.max(0, Math.min(100, progress)))}%`;
  }
  return durationMs === undefined ? "" : formatCliDuration(durationMs);
}

export function TaskDetailColumn({
  progress,
  durationMs,
  running,
}: {
  readonly progress: number | undefined;
  readonly durationMs: number | undefined;
  readonly running: boolean;
}): React.ReactElement {
  const theme = useCliTheme();
  const text = taskDetailText(progress, durationMs, running);
  return (
    <Box flexShrink={0} width={TASK_DETAIL_COLUMN_WIDTH} justifyContent="flex-end" marginLeft={1}>
      <Text color={theme.level === "advanced" ? theme.medium : undefined}>{text}</Text>
    </Box>
  );
}
