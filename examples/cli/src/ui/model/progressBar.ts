/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

const FRACTIONS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const;

/**
 * Block bar with 8-level sub-cell precision, bracketed so it reads as a bar
 * rather than as run-on text.
 */
export function unicodeBar(progress: number, length: number): string {
  const distance = (Math.max(0, Math.min(100, progress)) / 100) * length;
  let bar = "█".repeat(Math.floor(distance));
  bar += FRACTIONS[Math.round((distance % 1) * 7)] ?? "";
  bar += "▏".repeat(Math.max(0, length - bar.length));
  return `▕${bar}▏`;
}

/** Indeterminate marquee: a block that shifts one cell per tick. */
export function marqueeBar(tick: number, length: number): string {
  const blockWidth = 3;
  const offset = tick % (length + blockWidth);
  let bar = "";
  for (let i = 0; i < length; i++) bar += i >= offset - blockWidth && i < offset ? "█" : "░";
  return `▕${bar}▏`;
}
