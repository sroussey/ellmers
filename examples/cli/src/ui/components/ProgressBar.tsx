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
    return <Text color={color}>{marqueeBar(tick, width)}</Text>;
  }
  return <Text color={color}>{unicodeBar(progress, width)}</Text>;
}
