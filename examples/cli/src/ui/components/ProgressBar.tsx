/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { useCliTheme } from "../CliThemeContext";

interface ProgressBarProps {
  readonly progress: number | undefined;
  readonly width?: number;
}

/**
 * Build a Unicode block-character progress bar with 8-level sub-pixel precision.
 * Uses U+2588–U+258F fractional blocks for smooth animation.
 */
function createBar(progress: number, length: number): string {
  const distance = progress * length;
  let bar = "";
  bar += "█".repeat(Math.floor(distance));
  const c = Math.round((distance % 1) * 7);
  switch (c) {
    case 1:
      bar += "▏";
      break;
    case 2:
      bar += "▎";
      break;
    case 3:
      bar += "▍";
      break;
    case 4:
      bar += "▌";
      break;
    case 5:
      bar += "▋";
      break;
    case 6:
      bar += "▊";
      break;
    case 7:
      bar += "▉";
      break;
  }
  bar += "▏".repeat(length > bar.length ? length - bar.length : 0);
  return "▕" + bar + "▏";
}

/**
 * Build an indeterminate marquee — a small block of filled cells that shifts
 * across the bar over time. The `tick` argument advances each animation frame.
 */
function createIndeterminateBar(tick: number, length: number): string {
  const blockWidth = 3;
  const period = length + blockWidth;
  const offset = tick % period;
  let bar = "";
  for (let i = 0; i < length; i++) {
    const within = i >= offset - blockWidth && i < offset;
    bar += within ? "█" : "░";
  }
  return "▕" + bar + "▏";
}

export function ProgressBar({ progress, width = 15 }: ProgressBarProps): React.ReactElement {
  const theme = useCliTheme();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (progress !== undefined) return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [progress]);

  const color = theme.level === "advanced" ? theme.medium : undefined;
  if (progress === undefined) {
    return <Text color={color}>{createIndeterminateBar(tick, width)}</Text>;
  }
  const clamped = Math.max(0, Math.min(100, progress));
  return <Text color={color}>{createBar(clamped / 100, width)}</Text>;
}
