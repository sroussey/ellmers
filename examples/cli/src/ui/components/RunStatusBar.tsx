/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";
import type { RunState } from "../model/runRowModel";
import { deriveRunState, runStateColor, runStatusBarFields } from "../model/runRowModel";

export { deriveRunState, runStatusBarFields };
export type { RunState };

/**
 * The run's footer: what it spent, how much of the graph landed, and how it
 * ended. Ruled off from the rows because it reports on the run rather than on
 * any task, and an unruled line directly under the last row reads as one more
 * task.
 *
 * Renders nothing for a run with neither spend nor a second task — a rule and
 * the word "completed" under a single row is ceremony, not information.
 */
export function RunStatusBar({
  usageLine,
  done,
  total,
  state,
}: {
  readonly usageLine: string;
  readonly done: number;
  readonly total: number;
  readonly state: RunState;
}): React.ReactElement | null {
  const theme = useCliTheme();
  const advanced = theme.level === "advanced";
  if (!usageLine && total <= 1) return null;
  const stateColor = advanced ? runStateColor(state) : undefined;
  return (
    <Box
      flexDirection="row"
      gap={3}
      width="100%"
      borderStyle="single"
      borderColor={advanced ? theme.medium : undefined}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={0}
    >
      {usageLine ? (
        <Box flexDirection="row">
          <Text dimColor>Tokens </Text>
          <Text color={advanced ? theme.fg : undefined}>{usageLine}</Text>
        </Box>
      ) : null}
      {total > 1 ? <Text dimColor>{`${done} / ${total} tasks`}</Text> : null}
      {state ? <Text color={stateColor}>{state}</Text> : null}
    </Box>
  );
}
