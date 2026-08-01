/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from "ink";
import React from "react";
import { cliTaskShowsProgressBar, cliTaskStatusGlyph, cliTaskStatusGlyphColor } from "../cliTaskUi";
import { useCliTheme } from "../CliThemeContext";
import { CliSpinner } from "./CliSpinner";

interface TaskStatusLineProps {
  /** Display name for the row — a task title, class type name, or an iteration marker. */
  readonly label: string;
  readonly status: string;
  readonly message?: string;
  /**
   * When false, use a static status column (no {@link CliSpinner}) even while running.
   * Avoids multiple spinners + frequent redraws that can confuse Ink/log-update.
   */
  readonly animateStatus?: boolean;
  /** When set with animation, parent supplies spinner frame (batched refresh). */
  readonly spinnerFrame?: number;
}

export function TaskStatusLine({
  label,
  status,
  message,
  animateStatus = true,
  spinnerFrame,
}: TaskStatusLineProps): React.ReactElement {
  const theme = useCliTheme();
  const glyph = cliTaskStatusGlyph(status);
  const color = theme.level === "advanced" ? cliTaskStatusGlyphColor(status) : undefined;
  const bodyColor = theme.level === "advanced" ? theme.fg : undefined;
  const msgText = message ? ` — ${message}` : "";
  const showSpinner = cliTaskShowsProgressBar(status) && animateStatus;

  return (
    <Text wrap="truncate-end">
      {showSpinner ? (
        <CliSpinner color={color} frameIndex={spinnerFrame} />
      ) : (
        <Text color={color}>{glyph}</Text>
      )}
      <Text color={bodyColor}>
        {" "}
        {label}
        {msgText}
      </Text>
    </Text>
  );
}
