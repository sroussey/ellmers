/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";
import { taskDetailText } from "../model/runRowModel";

/** Column width holds the widest value either state produces (`847ms`, `100%`). */
export const TASK_DETAIL_COLUMN_WIDTH = 6;

export { taskDetailText };

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
