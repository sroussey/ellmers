/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask } from "@workglow/task-graph";
import { Box, Text } from "ink";
import React from "react";
import { useCliTheme } from "../CliThemeContext";

const MAX_LINES = 3;
const MAX_CHARS = 400;

/**
 * The runner wraps a failure as `Task "Type" (id): reason`. The row above the
 * detail already names the task, so the prefix spends a line's width restating
 * it and pushes the reason — the only part an operator cannot already see —
 * off the end of a narrow terminal.
 */
const RUNNER_PREFIX = /^Task\s+"[^"]*"\s*\([^)]*\):\s*/;

/**
 * A failed row names the task and nothing else, which leaves the operator to
 * re-run with more logging to learn what went wrong. The reason is already on
 * the task — show it, bounded, under the row it belongs to.
 */
export function taskErrorText(task: ITask | undefined, status: string): string {
  if (status !== "FAILED") return "";
  const error = task?.error;
  if (!error) return "";
  const raw = typeof error.message === "string" && error.message ? error.message : String(error);
  const reason = raw.replace(RUNNER_PREFIX, "");
  const clipped = reason.length > MAX_CHARS ? `${reason.slice(0, MAX_CHARS)}…` : reason;
  const lines = clipped.split("\n").filter((l) => l.trim() !== "");
  return lines.slice(0, MAX_LINES).join("\n");
}

export function TaskErrorDetail({
  task,
  status,
  marginLeft = 2,
}: {
  readonly task: ITask | undefined;
  readonly status: string;
  readonly marginLeft?: number;
}): React.ReactElement | null {
  const theme = useCliTheme();
  const text = taskErrorText(task, status);
  if (!text) return null;
  return (
    <Box marginLeft={marginLeft} flexDirection="column">
      <Text color={theme.level === "advanced" ? "red" : undefined} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  );
}
