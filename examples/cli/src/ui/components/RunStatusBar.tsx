/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";
import type { RunTaskCounts } from "../model/runCensus";
import type { RunState } from "../model/runRowModel";
import { deriveRunState, runStateColor, runStatusBarModel } from "../model/runRowModel";

export { deriveRunState, runStatusBarModel };
export type { RunState };

const FIELD_SEPARATOR = "·";

/**
 * The run's footer: how much of the graph has landed, what it spent, and how
 * long it has been going. Ruled off from the rows because it reports on the run
 * rather than on any task, and an unruled line directly under the last row
 * reads as one more task.
 *
 * The clock sits hard right, on its own, because it is the one field that
 * changes every second: leaving it in the flow would shove the counts and the
 * spend sideways each tick, and a number nobody can hold still is a number
 * nobody reads.
 */
export function RunStatusBar({
  usageLine,
  counts,
  state,
  elapsedMs,
  hiddenRows = 0,
}: {
  readonly usageLine: string;
  readonly counts: RunTaskCounts;
  readonly state: RunState;
  readonly elapsedMs: number | undefined;
  /** Sibling rows the viewport is holding back; reported so nothing is hidden silently. */
  readonly hiddenRows?: number;
}): React.ReactElement | null {
  const theme = useCliTheme();
  const advanced = theme.level === "advanced";
  const model = runStatusBarModel({ usageLine, counts, state, elapsedMs, hiddenRows });
  if (!model.visible) return null;

  const stateColor = advanced ? runStateColor(model.state) : undefined;
  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
      borderStyle="single"
      borderColor={advanced ? theme.medium : undefined}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={0}
    >
      <Box flexDirection="row" flexGrow={1} minWidth={0} overflow="hidden" gap={1}>
        {model.state ? <Text color={stateColor}>{model.state}</Text> : null}
        {model.fields.map((field, index) => (
          <Box key={field} flexDirection="row" gap={1} flexShrink={0}>
            {index > 0 || model.state ? <Text dimColor>{FIELD_SEPARATOR}</Text> : null}
            <Text color={advanced ? theme.fg : undefined}>{field}</Text>
          </Box>
        ))}
      </Box>
      {model.timer ? (
        <Box flexShrink={0} marginLeft={2}>
          <Text color={advanced ? theme.medium : undefined}>{model.timer}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
