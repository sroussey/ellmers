/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text, useAnimation } from "ink";
import React from "react";

/** Braille-pattern frames (same family as cli-spinners “dots”). */
export const CLI_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface CliSpinnerProps {
  readonly color?: string;
  /** When set, parent drives animation (e.g. batched with progress updates). */
  readonly frameIndex?: number;
}

export function CliSpinner({ color, frameIndex }: CliSpinnerProps): React.ReactElement {
  const controlled = frameIndex !== undefined;
  const { frame } = useAnimation({ interval: 80, isActive: !controlled });
  const activeFrame = frameIndex ?? frame;
  const i = activeFrame % CLI_SPINNER_FRAMES.length;
  return <Text color={color}>{CLI_SPINNER_FRAMES[i]}</Text>;
}
