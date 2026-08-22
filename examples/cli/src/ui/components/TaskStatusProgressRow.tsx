/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box } from "ink";
import React from "react";
import { cliTaskShowsProgressBar } from "../cliTaskUi";
import { ProgressBar } from "./ProgressBar";
import { TaskDetailColumn } from "./TaskDetailColumn";
import { TaskStatusLine } from "./TaskStatusLine";

export interface TaskStatusProgressRowProps {
  /** Display name for the row — a task title, class type name, or an iteration marker. */
  readonly label: string;
  readonly status: string;
  readonly message?: string;
  /**
   * Measured progress, or `undefined` when the task reports none. Undefined
   * draws no bar and no percentage: an empty determinate bar reads as "0% and
   * stuck", which is a different claim than "working, extent unknown" — the
   * spinner in the status column already carries that one.
   */
  readonly barProgress: number | undefined;
  /** Wall-clock for a settled row; shown in the trailing column instead of a percentage. */
  readonly durationMs?: number;
  readonly marginLeft?: number;
  /** When true, never draw the bar (e.g. iteration row running but no numeric progress yet) */
  readonly suppressProgressBar?: boolean;
  /** Pass false for secondary rows (e.g. per-file lines) so only one row animates a spinner. */
  readonly animateStatus?: boolean;
  /** Batched spinner frame for the main row (see {@link TaskRunApp}). */
  readonly spinnerFrame?: number;
  /** Bar segment count; default matches {@link ProgressBar}. */
  readonly progressBarWidth?: number;
}

/**
 * Task status on the left, an optional Unicode progress bar on the right, and a
 * fixed trailing column carrying the row's one number — percent while it runs,
 * elapsed once it settles.
 */
export function TaskStatusProgressRow({
  label,
  status,
  message,
  barProgress,
  durationMs,
  marginLeft,
  suppressProgressBar = false,
  animateStatus = true,
  spinnerFrame,
  progressBarWidth,
}: TaskStatusProgressRowProps): React.ReactElement {
  const running = cliTaskShowsProgressBar(status);
  const showBar = running && !suppressProgressBar && barProgress !== undefined;
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%" marginLeft={marginLeft}>
      <Box flexGrow={1} minWidth={0} overflow="hidden">
        <TaskStatusLine
          label={label}
          status={status}
          message={message}
          animateStatus={animateStatus}
          spinnerFrame={spinnerFrame}
        />
      </Box>
      {showBar && (
        <Box flexShrink={0} marginLeft={1}>
          <ProgressBar progress={barProgress} width={progressBarWidth} />
        </Box>
      )}
      <TaskDetailColumn progress={barProgress} durationMs={durationMs} running={running} />
    </Box>
  );
}
