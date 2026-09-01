/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from "ink";
import React, { useEffect, useState } from "react";
import { useCliTheme } from "../CliThemeContext";
import { marqueeBar, unicodeBar } from "../model/progressBar";

interface ProgressBarProps {
  readonly progress: number | undefined;
  readonly width?: number;
  /**
   * Draws the bar a step further from the page color. For the one bar that
   * reports on the whole run rather than on a task inside it — the eye should
   * find it first among a screenful of identical bars.
   */
  readonly emphasis?: boolean;
}

export function ProgressBar({
  progress,
  width = 15,
  emphasis = false,
}: ProgressBarProps): React.ReactElement {
  const theme = useCliTheme();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (progress !== undefined) return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [progress]);

  const color = theme.level === "advanced" ? (emphasis ? theme.strong : theme.medium) : undefined;
  if (progress === undefined) {
    return <Text color={color}>{marqueeBar(tick, width)}</Text>;
  }
  return <Text color={color}>{unicodeBar(progress, width)}</Text>;
}
