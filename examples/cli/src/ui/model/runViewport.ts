/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CensusList, CensusNode } from "./runCensus";

/**
 * How a run's rows are fitted into the terminal, independent of what draws
 * them.
 *
 * Two rules shape everything here.
 *
 * **The live region never shrinks.** A block whose height tracks its content
 * drags the footer up the screen every time a list gets shorter, and a footer
 * that moves is a footer nobody can read. The region grows to fit what arrives
 * and then holds that height ({@link stickyRegionHeight}) until the terminal
 * itself changes size.
 *
 * **Depth pays for the overflow.** When the tree wants more rows than the
 * terminal has, the rows that go are the innermost ones — a Map's per-item
 * detail — because the ancestors are the context that makes the detail legible.
 * Losing the Map's own row to show six more of its items is exactly backwards,
 * so {@link planRunViewport} shrinks the deepest list first and only climbs
 * when that list is down to a single row.
 */

/** Rows one list shows before it starts hiding siblings. */
export const MAX_VISIBLE_LIST_ROWS = 6;

/** A truncated list always keeps at least this many rows — an empty parent says nothing. */
export const MIN_VISIBLE_LIST_ROWS = 1;

/** Guard on the shrink loop; a plan is not worth an unbounded search. */
const MAX_SHRINK_STEPS = 2000;

export interface RunViewportPlan {
  /** Visible sibling count per list key. Absent keys fall back to {@link MAX_VISIBLE_LIST_ROWS}. */
  readonly caps: ReadonlyMap<string, number>;
  /** Rows the plan expects to draw. */
  readonly rows: number;
  /** Sibling rows hidden across every list. */
  readonly hidden: number;
  /** True when even the minimum plan overflows the budget. */
  readonly overflowing: boolean;
}

export const EMPTY_RUN_VIEWPORT_PLAN: RunViewportPlan = {
  caps: new Map(),
  rows: 0,
  hidden: 0,
  overflowing: false,
};

/** The cap a list draws with, given a plan that may not mention it. */
export function listCap(plan: RunViewportPlan, listKey: string): number {
  return plan.caps.get(listKey) ?? MAX_VISIBLE_LIST_ROWS;
}

/**
 * The slice of a list that is drawn: the tail.
 *
 * Rows are sorted completed-first, so the tail is the work in flight. A list
 * that dropped its tail would animate a spinner nobody can see.
 */
export function visibleSlice<T>(rows: readonly T[], cap: number): readonly T[] {
  if (cap >= rows.length) return rows;
  return rows.slice(rows.length - Math.max(0, cap));
}

interface ListInfo {
  readonly list: CensusList;
  readonly depth: number;
}

function indexLists(root: CensusList): Map<string, ListInfo> {
  const out = new Map<string, ListInfo>();
  const walk = (list: CensusList, depth: number): void => {
    out.set(list.key, { list, depth });
    for (const node of list.nodes) {
      for (const child of node.lists) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function nodeRows(node: CensusNode, caps: Map<string, number>): number {
  let total = node.ownRows;
  for (const list of node.lists) total += listRows(list, caps);
  return total;
}

function listRows(list: CensusList, caps: Map<string, number>): number {
  const cap = caps.get(list.key) ?? MAX_VISIBLE_LIST_ROWS;
  const visible = visibleSlice(list.nodes, cap);
  let total = 0;
  for (const node of visible) total += nodeRows(node, caps);
  // The line that says what was hidden is itself a row.
  if (visible.length < list.nodes.length) total += 1;
  return total;
}

function countHidden(root: CensusList, caps: Map<string, number>): number {
  const infos = indexLists(root);
  let hidden = 0;
  for (const [key, info] of infos) {
    const cap = caps.get(key) ?? MAX_VISIBLE_LIST_ROWS;
    hidden += Math.max(0, info.list.nodes.length - cap);
  }
  return hidden;
}

/**
 * Chooses how many siblings each list shows so the tree fits `budget` rows.
 *
 * Deepest-first, widest-first among equals: the list that gives up a row is the
 * one whose rows are the most redundant with the rows around them. A list at
 * {@link MIN_VISIBLE_LIST_ROWS} is out of the running, which is what stops the
 * search from erasing a parent to save a child.
 */
export function planRunViewport(root: CensusList, budget: number): RunViewportPlan {
  const infos = indexLists(root);
  const caps = new Map<string, number>();
  for (const [key, info] of infos) {
    caps.set(key, Math.min(info.list.nodes.length, MAX_VISIBLE_LIST_ROWS));
  }

  let rows = listRows(root, caps);
  const limit = Math.max(1, budget);
  let steps = 0;

  while (rows > limit && steps++ < MAX_SHRINK_STEPS) {
    let victim: string | undefined;
    let victimDepth = -1;
    let victimCap = 0;
    for (const [key, info] of infos) {
      const cap = caps.get(key) ?? 0;
      if (cap <= MIN_VISIBLE_LIST_ROWS) continue;
      if (info.depth > victimDepth || (info.depth === victimDepth && cap > victimCap)) {
        victim = key;
        victimDepth = info.depth;
        victimCap = cap;
      }
    }
    if (victim === undefined) break;
    caps.set(victim, victimCap - 1);
    rows = listRows(root, caps);
  }

  return {
    caps,
    rows,
    hidden: countHidden(root, caps),
    overflowing: rows > limit,
  };
}

/**
 * The height the live region holds this frame.
 *
 * Grows to whatever the content needs, never shrinks on its own, and is capped
 * by what the terminal can show. `held` coming back larger than `budget` is the
 * resize case — the window got shorter, and the region has to give the rows
 * back rather than scroll the prompt off the top.
 */
export function stickyRegionHeight(args: {
  readonly naturalRows: number;
  readonly heldRows: number;
  readonly budgetRows: number;
}): number {
  const budget = Math.max(0, Math.floor(args.budgetRows));
  const wanted = Math.max(Math.max(0, args.naturalRows), Math.max(0, args.heldRows));
  return Math.min(budget, wanted);
}

/**
 * Rows of content scrolled off the top of a tail-pinned region.
 *
 * The region shows the end of the content, because the end is the live work.
 * Everything earlier is above the fold, and the gutter is what says so.
 */
export function tailScrollOffset(naturalRows: number, visibleRows: number): number {
  return Math.max(0, Math.floor(naturalRows) - Math.max(0, Math.floor(visibleRows)));
}

/** Track and thumb glyphs of the scroll gutter. Both are one cell wide in every font. */
export const SCROLL_TRACK_GLYPH = "│";
export const SCROLL_THUMB_GLYPH = "┃";

/**
 * A one-column scrollbar drawn beside a clipped region: one glyph per visible
 * row, a thumb whose length and position report how much is hidden and where
 * the view sits.
 *
 * The gutter rather than a summary line because it costs no rows — the thing in
 * shortest supply when content is being hidden in the first place — and because
 * it sits next to the rows it describes instead of at an edge the eye has to go
 * looking for.
 */
export function scrollGutter(args: {
  readonly totalRows: number;
  readonly visibleRows: number;
  readonly offsetRows: number;
}): string[] {
  const visible = Math.max(0, Math.floor(args.visibleRows));
  const total = Math.max(visible, Math.floor(args.totalRows));
  if (visible === 0) return [];
  if (total <= visible) return Array.from({ length: visible }, () => " ");

  const thumb = Math.max(1, Math.min(visible, Math.round((visible / total) * visible)));
  const maxOffset = total - visible;
  const offset = Math.max(0, Math.min(maxOffset, Math.floor(args.offsetRows)));
  const travel = visible - thumb;
  const top = travel === 0 ? 0 : Math.round((offset / maxOffset) * travel);

  return Array.from({ length: visible }, (_, i) =>
    i >= top && i < top + thumb ? SCROLL_THUMB_GLYPH : SCROLL_TRACK_GLYPH
  );
}

/**
 * What a truncated sibling list is not showing, as one line.
 *
 * Reports by outcome rather than by position: "42 done" is the fact an operator
 * wants, and "rows 1–42" is the fact a scrollbar already carries.
 */
export function hiddenSiblingsLine(hiddenStatuses: readonly string[], glyph: string = "▲"): string {
  if (hiddenStatuses.length === 0) return "";
  let done = 0;
  let failed = 0;
  let pending = 0;
  for (const status of hiddenStatuses) {
    if (status === "COMPLETED" || status === "DISABLED") done++;
    else if (status === "FAILED" || status === "ABORTED") failed++;
    else pending++;
  }
  const parts: string[] = [];
  if (done > 0) parts.push(`${done} done`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (pending > 0) parts.push(`${pending} more`);
  return `${glyph} ${parts.join(" · ")}`;
}
