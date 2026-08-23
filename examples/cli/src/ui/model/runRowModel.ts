/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatCliDuration } from "../formatCliDuration";

/**
 * How a run row is drawn, independent of what draws it. The terminal renders
 * these with Ink and the web console renders them with DOM nodes; both must
 * agree on the glyph, the order, and the one number a row reports, so neither
 * owns the rules.
 *
 * Nothing in this directory may import a renderer. `runRowModel.test.ts`
 * enforces that.
 */

/** The shape a row needs to sort — a full task line has more, and none of it matters here. */
export interface RowLike {
  readonly id: string;
  readonly status: string;
}

/** One iteration slot of a Map/Reduce task. */
export interface SlotLike {
  readonly status: "pending" | "running" | "completed";
}

/** Single-character status column: done → active (a spinner replaces this) → waiting → error. */
export function cliTaskStatusGlyph(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "✓"; // ✓
    case "PROCESSING":
    case "STREAMING":
    case "ABORTING":
      return " "; // non-breaking space — the renderer draws a spinner instead
    case "PENDING":
      return "○"; // ○
    case "FAILED":
    case "ABORTED":
      return "✗"; // ✗
    case "DISABLED":
      return "⊘"; // ⊘
    default:
      return "•"; // •
  }
}

export function cliTaskStatusGlyphColor(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "green";
    case "PROCESSING":
    case "STREAMING":
    case "ABORTING":
      return "yellow";
    case "PENDING":
      return "gray";
    case "FAILED":
    case "ABORTED":
      return "red";
    case "DISABLED":
      return "gray";
    default:
      return "white";
  }
}

/**
 * Sort key: completed (0), then processing-like (1), then pending (2), then
 * failures, etc. Secondary: graph order index.
 */
export function cliTaskStatusSortOrder(status: string): number {
  if (status === "COMPLETED") return 0;
  if (status === "PROCESSING" || status === "STREAMING" || status === "ABORTING") return 1;
  if (status === "PENDING") return 2;
  if (status === "FAILED" || status === "ABORTED") return 3;
  if (status === "DISABLED") return 4;
  return 5;
}

export function sortCliTaskLinesForDisplay<T extends RowLike>(
  tasks: readonly T[],
  graphOrder: ReadonlyMap<string, number>
): T[] {
  return [...tasks].sort((a, b) => {
    const ta = cliTaskStatusSortOrder(a.status);
    const tb = cliTaskStatusSortOrder(b.status);
    if (ta !== tb) return ta - tb;
    return (graphOrder.get(a.id) ?? 999) - (graphOrder.get(b.id) ?? 999);
  });
}

/** When to draw a numeric progress bar (not just status text). */
export function cliTaskShowsProgressBar(status: string): boolean {
  return status === "PROCESSING" || status === "STREAMING" || status === "ABORTING";
}

/**
 * The one number at the end of a task row: how far along it is while it runs,
 * and how long it took once it settles. Two states of one column rather than
 * two columns, because only one of them is ever true.
 */
export function taskDetailText(
  progress: number | undefined,
  durationMs: number | undefined,
  running: boolean
): string {
  if (running) {
    if (progress === undefined) return "";
    return `${Math.round(Math.max(0, Math.min(100, progress)))}%`;
  }
  return durationMs === undefined ? "" : formatCliDuration(durationMs);
}

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

export function runStateColor(state: RunState): string | undefined {
  switch (state) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "aborted":
    case "running":
      return "yellow";
    default:
      return undefined;
  }
}

/**
 * The fields the run's footer carries, in order. A task count says nothing
 * about a single-task graph that its one row does not already show, so it is
 * omitted there.
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
 * What the capped iteration rows are not showing. The visible rows are the work
 * in flight; without this the rest of a large map is invisible.
 *
 * Reports only what the slots actually know: above the full-tracking cap the
 * caller retains running iterations only, so there is no honest done or queued
 * count to print and the line reduces to the extra running ones.
 */
export function iterationSummaryLine(
  slots: readonly SlotLike[] | undefined,
  visibleCount: number
): string {
  if (!slots || slots.length <= visibleCount) return "";
  let running = 0;
  let done = 0;
  let queued = 0;
  for (const slot of slots) {
    if (slot.status === "running") running++;
    else if (slot.status === "completed") done++;
    else queued++;
  }
  const parts: string[] = [];
  if (running > visibleCount) parts.push(`${running - visibleCount} more running`);
  if (done > 0) parts.push(`${done} done`);
  if (queued > 0) parts.push(`${queued} queued`);
  return parts.join(" · ");
}
