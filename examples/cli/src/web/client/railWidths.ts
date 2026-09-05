/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Widths of the two rails, in pixels. The shell is a three-column grid and
 * both outer columns are draggable, so the numbers live here — clamping and
 * persistence are the parts worth testing, and neither needs a DOM.
 */

export type RailSide = "left" | "right";

export const RAIL_DEFAULTS: Readonly<Record<RailSide, number>> = { left: 266, right: 248 };

/**
 * Below these a rail stops being usable rather than merely narrow: the command
 * tree loses its indent, the status lines lose their value column.
 */
const RAIL_MIN: Readonly<Record<RailSide, number>> = { left: 200, right: 180 };

/** Past this a rail is no longer a rail, whatever the window can afford. */
const RAIL_MAX = 560;

/** The centre column keeps this much even when both rails are dragged wide. */
const MIN_MAIN = 360;

export interface RailWidths {
  readonly left: number;
  readonly right: number;
}

/**
 * The width a drag actually lands on: never below the side's minimum, never
 * past `RAIL_MAX`, and never so wide that the centre column drops under
 * `MIN_MAIN`. The minimum wins over the viewport budget on a narrow window —
 * a rail that collapses to nothing is worse than one that overflows, and the
 * layout drops to stacked panes down there anyway.
 */
export function clampRailWidth(
  side: RailSide,
  width: number,
  viewport: number,
  otherWidth: number
): number {
  const min = RAIL_MIN[side];
  const budget = viewport - otherWidth - MIN_MAIN;
  const max = Math.max(min, Math.min(RAIL_MAX, budget));
  return Math.round(Math.min(max, Math.max(min, width)));
}

const STORAGE_KEY = "workglow.web.railWidths";

interface WidthStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): WidthStore | undefined {
  // Reading localStorage THROWS in a browser set to block site data, so even
  // the lookup is guarded rather than only the call.
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function readWidth(side: RailSide, raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : RAIL_DEFAULTS[side];
  return Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN[side], value)));
}

/**
 * Last session's widths, or the defaults. Anything unparseable is the default:
 * a corrupt entry must not leave the page with no rails.
 */
export function loadRailWidths(store: WidthStore | undefined = defaultStore()): RailWidths {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return RAIL_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Record<RailSide, unknown>>;
    return { left: readWidth("left", parsed?.left), right: readWidth("right", parsed?.right) };
  } catch {
    return RAIL_DEFAULTS;
  }
}

export function saveRailWidths(
  widths: RailWidths,
  store: WidthStore | undefined = defaultStore()
): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // A full or blocked store costs the next session its widths, nothing more.
  }
}
