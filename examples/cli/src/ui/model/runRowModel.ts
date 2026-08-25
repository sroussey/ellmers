/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatCliDuration } from "../formatCliDuration";
import type { RunTaskCounts } from "./runCensus";

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

/**
 * The status a row reports once its own children contradict it.
 *
 * `context.own(new Workflow())` puts a wrapper task in the subgraph so the
 * workflow's tasks have somewhere to live, and the caller then runs the
 * workflow rather than the wrapper. The wrapper therefore never leaves
 * PENDING — it draws a `○` beside a subtree that has plainly finished, and
 * counts as one task that can never land. A parent whose children have started
 * is not waiting; it is the thing they are doing, and this says so.
 *
 * Only ever reads up from PENDING, so a task that genuinely reports its own
 * status keeps it.
 */
export function ownershipWrapperStatus(status: string, childStatuses: readonly string[]): string {
  if (status !== "PENDING" || childStatuses.length === 0) return status;
  let started = false;
  let failed = false;
  for (const child of childStatuses) {
    if (child === "PENDING") continue;
    started = true;
    if (child === "PROCESSING" || child === "STREAMING" || child === "ABORTING") {
      return "PROCESSING";
    }
    if (child === "FAILED" || child === "ABORTED") failed = true;
  }
  if (!started) return status;
  return failed ? "FAILED" : "COMPLETED";
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
 * Wall-clock for a run in progress, as a clock rather than a duration.
 *
 * {@link formatCliDuration} answers "how long did that take", and switches
 * units as it goes — `847ms`, `12.4s`, `2m 15s` — which is right on a row that
 * settles once and is then read at leisure. A footer timer is read while it
 * moves, and a field that changes width every few seconds drags everything
 * beside it back and forth, so this one keeps `M:SS` (and `H:MM:SS` past the
 * hour) and stays put.
 */
export function formatRunClock(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const seconds = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const minutes = totalMin % 60;
  const hours = Math.floor(totalMin / 60);
  const ss = String(seconds).padStart(2, "0");
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}

/** Everything the run footer reports, in the order it is laid out. */
export interface RunStatusBarInput {
  /** Directional token counts and cost, already formatted. */
  readonly usageLine: string;
  readonly counts: RunTaskCounts;
  readonly state: RunState;
  /** Wall-clock since the run started, or `undefined` before it has. */
  readonly elapsedMs: number | undefined;
  /** Sibling rows the viewport is not drawing. */
  readonly hiddenRows: number;
}

export interface RunStatusBarModel {
  /** Left-aligned fields, in order. */
  readonly fields: readonly string[];
  /** Right-aligned wall-clock; empty when the run has not started. */
  readonly timer: string;
  readonly state: RunState;
  /** False when the bar would say nothing the rows above it do not already. */
  readonly visible: boolean;
}

/** Below this a run is short enough that a timer is noise rather than news. */
const TIMER_VISIBLE_AFTER_MS = 1500;

function formatTaskCount(counts: RunTaskCounts): string {
  const total = counts.approximate ? `${counts.total}+` : String(counts.total);
  return `${counts.done} / ${total} tasks`;
}

/**
 * The run's footer.
 *
 * Task counts come from the whole tree, not the top level: a task that owns a
 * workflow or maps over a worklist does its work in nodes the top level never
 * mentions, and `1 / 3 tasks` under three hundred running rows is a footer
 * reporting on the wrong run.
 *
 * A single-task run with nothing to spend and nowhere to go gets no bar at all
 * — a rule and the word "completed" under one row is ceremony, not information.
 */
export function runStatusBarModel(input: RunStatusBarInput): RunStatusBarModel {
  const { counts, usageLine, state, elapsedMs, hiddenRows } = input;
  const timer =
    elapsedMs !== undefined && elapsedMs >= TIMER_VISIBLE_AFTER_MS ? formatRunClock(elapsedMs) : "";

  const fields: string[] = [];
  if (counts.total > 1) fields.push(formatTaskCount(counts));
  if (counts.failed > 0) fields.push(`${counts.failed} failed`);
  if (usageLine) fields.push(usageLine);
  if (hiddenRows > 0) fields.push(`${hiddenRows} hidden`);

  // The outcome alone does not earn a bar. A rule and the word "completed"
  // under a single row that already shows a tick is ceremony, not information;
  // the bar appears when it has a count, a spend, or a clock worth reading.
  return { fields, timer, state, visible: fields.length > 0 || timer !== "" };
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
