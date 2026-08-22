/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";

/** How the run as a whole ended up, derived from the statuses of its tasks. */
export type RunState = "running" | "completed" | "failed" | "aborted" | "";

/**
 * A run's own outcome, which no single row carries: one failure decides the
 * run even when every other task completed, and a run is only `completed` when
 * nothing is left. Reported from the task statuses rather than tracked
 * separately so it cannot disagree with the rows above it.
 */
export function deriveRunState(statuses: readonly string[]): RunState {
  if (statuses.length === 0) return "";
  let sawFailure = false;
  let sawAbort = false;
  let sawSettled = false;
  for (const status of statuses) {
    switch (status) {
      case "PROCESSING":
      case "STREAMING":
      case "ABORTING":
        return "running";
      case "FAILED":
        sawFailure = true;
        sawSettled = true;
        break;
      case "ABORTED":
        sawAbort = true;
        sawSettled = true;
        break;
      case "COMPLETED":
        sawSettled = true;
        break;
      default:
        break;
    }
  }
  if (sawFailure) return "failed";
  if (sawAbort) return "aborted";
  if (!sawSettled) return "";
  return statuses.every((s) => s === "COMPLETED" || s === "DISABLED") ? "completed" : "running";
}

function runStateColor(state: RunState): string | undefined {
  switch (state) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "aborted":
      return "yellow";
    case "running":
      return "yellow";
    default:
      return undefined;
  }
}

/**
 * The fields the bar carries, in order. Separated from the render so the
 * composition can be checked without a terminal.
 *
 * A task count says nothing about a single-task graph that its one row does not
 * already show, so it is omitted there.
 */
export function runStatusBarFields(
  usageLine: string,
  done: number,
  total: number,
  state: RunState
): string[] {
  const fields: string[] = [];
  if (usageLine) fields.push(`Tokens ${usageLine}`);
  if (total > 1) fields.push(`${done} / ${total} tasks`);
  if (state) fields.push(state);
  return fields;
}

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
