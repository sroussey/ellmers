/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebTone } from "./annotations";
import type { WebInvocation } from "./argv";

/**
 * What a downstream package contributes to the console.
 *
 * Data crosses this seam, never code. A client-side extension would mean a
 * superset shipping a browser bundle, a stable client API to bundle against,
 * and a way to serve it — for a use case that is, in every instance we have, a
 * table of rows. When a genuinely custom rendering turns up, the escape hatch
 * is a new {@link PanelData} kind, which is one shared change rather than a
 * plugin loader.
 */
/**
 * The command one row of a table is an argument for.
 *
 * A worklist is only half of the work: a table of suggested aliases is read to
 * decide which ones to record, and recording one means copying two values out
 * of the table and typing them into another command's form. This carries that
 * command with the row instead.
 *
 * The console FILLS the form and switches to it; it does not run it. The rows
 * that have an action are the ones a human is being asked to judge, and the
 * command behind the button is usually one that writes.
 */
export interface PanelRowAction {
  /** Button text. Short — it sits inside a table cell. */
  readonly label: string;
  /**
   * The button's tooltip. A cell has room for `Add →` and not for what the
   * arrow points at, so the sentence saying which value survives goes here.
   */
  readonly title?: string;
  /** The command to select, and the values to fill its form with. */
  readonly invocation: WebInvocation;
}

export type PanelData =
  | {
      readonly kind: "table";
      readonly columns: readonly string[];
      readonly rows: readonly (readonly string[])[];
      /**
       * Per-row tone, positionally aligned with `rows`. A triage table is read
       * for which rows are wrong, and reading that off the text is the work
       * the panel exists to save.
       */
      readonly rowTones?: readonly (WebTone | undefined)[];
      /**
       * Per-row actions, positionally aligned with `rows`. Rendered as one
       * extra column, present only when some row carries an action.
       *
       * A list rather than one action, because a row is not always a single
       * decision: a suggested alias is a pair of names and which of the two
       * survives is exactly what the reader is being asked, so that row offers
       * the merge in both directions.
       */
      readonly rowActions?: readonly (readonly PanelRowAction[] | undefined)[];
      /** Footnote under the table: what was truncated, what a column means. */
      readonly note?: string;
    }
  | { readonly kind: "kv"; readonly items: readonly (readonly [string, string])[] }
  /** A row of headline figures — the shape a report's summary actually has. */
  | {
      readonly kind: "stats";
      readonly items: readonly {
        readonly label: string;
        readonly value: string;
        readonly detail?: string;
        readonly tone?: WebTone;
      }[];
    }
  /** Dated events in order. A lifecycle is a timeline, not a table of two columns. */
  | {
      readonly kind: "timeline";
      readonly events: readonly {
        readonly date: string;
        readonly label: string;
        readonly detail?: string;
        readonly tone?: WebTone;
      }[];
    }
  | { readonly kind: "markdown"; readonly text: string }
  /**
   * Nothing to show, and why. An empty table renders as a header with no rows,
   * which reads as a failure rather than as the answer it usually is.
   */
  | { readonly kind: "empty"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface WebPanelContext {
  readonly invocation: WebInvocation;
  readonly output: unknown;
}

export interface WebPanel {
  readonly id: string;
  readonly title: string;
  /** Package name, shown as a badge so a contributed panel says who owns it. */
  readonly source: string;
  appliesTo(invocation: WebInvocation): boolean;
  load(context: WebPanelContext): Promise<PanelData>;
}

export interface WebFieldWidgetItem {
  readonly value: string;
  readonly label: string;
  readonly detail: string | undefined;
}

/**
 * The form around the field being searched.
 *
 * A picker is often only answerable in context: the accessions worth offering
 * are the ones belonging to the CIK typed two fields up, and the ids a version
 * ceremony accepts depend on the kind chosen beside them. Without this a
 * scoped picker has to offer everything and let the operator filter, which for
 * a filings table is not an offer at all.
 */
export interface WebFieldWidgetContext {
  readonly path: readonly string[];
  readonly args: readonly string[];
  /** Every field's current value, keyed as the form keys them. */
  readonly values: Readonly<Record<string, string>>;
}

export interface WebFieldWidget {
  /** Matches a schema `format` or a field annotation, which is how a field opts in. */
  readonly format: string;
  readonly source: string;
  search(query: string, context: WebFieldWidgetContext): Promise<readonly WebFieldWidgetItem[]>;
}

export interface WebStatusMeter {
  readonly kind?: "meter";
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly detail?: string;
}

/**
 * A status line that is not a proportion.
 *
 * Most of what an operator checks before starting work has no denominator —
 * which database is configured, whether the fetch queue is in a cooldown and
 * for how long, which version slot is active. Forcing those into a meter
 * either invents a maximum or renders a bar that means nothing.
 */
export interface WebStatusText {
  readonly kind: "text";
  readonly label: string;
  readonly value: string;
  readonly tone?: WebTone;
}

export type WebStatusItem = WebStatusMeter | WebStatusText;

export interface WebStatusWidget {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  read(): Promise<readonly WebStatusItem[]>;
}

const panels: WebPanel[] = [];
const fieldWidgets = new Map<string, WebFieldWidget>();
const statusWidgets: WebStatusWidget[] = [];
const statusReadCleanups: Array<() => Promise<void>> = [];

export function registerWebPanel(panel: WebPanel): void {
  const at = panels.findIndex((candidate) => candidate.id === panel.id);
  if (at >= 0) panels[at] = panel;
  else panels.push(panel);
}

export function listWebPanels(invocation?: WebInvocation): readonly WebPanel[] {
  if (!invocation) return [...panels];
  return panels.filter((panel) => {
    try {
      return panel.appliesTo(invocation);
    } catch {
      return false;
    }
  });
}

/**
 * Loads a panel, reporting a failure as a panel rather than throwing: a
 * superset's broken query must not take the whole Result tab down with it.
 */
export async function loadWebPanel(panel: WebPanel, context: WebPanelContext): Promise<PanelData> {
  try {
    return await panel.load(context);
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function registerWebFieldWidget(widget: WebFieldWidget): void {
  fieldWidgets.set(widget.format, widget);
}

export function getWebFieldWidget(format: string | undefined): WebFieldWidget | undefined {
  return format ? fieldWidgets.get(format) : undefined;
}

export function listWebFieldWidgetFormats(): readonly string[] {
  return [...fieldWidgets.keys()];
}

export function registerWebStatusWidget(widget: WebStatusWidget): void {
  const at = statusWidgets.findIndex((candidate) => candidate.id === widget.id);
  if (at >= 0) statusWidgets[at] = widget;
  else statusWidgets.push(widget);
}

/**
 * Runs after every status-rail read, success or failure.
 *
 * The rail is polled while the console is open. A package whose widgets open
 * database connections registers a cleanup here so those backends are closed
 * before the next 15s poll, instead of sitting idle until process exit.
 */
export function registerWebStatusReadCleanup(cleanup: () => Promise<void>): void {
  statusReadCleanups.push(cleanup);
}

export function listWebStatusWidgets(): readonly WebStatusWidget[] {
  return [...statusWidgets];
}

export interface WebStatusWidgetReading {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly items: readonly WebStatusItem[];
}

let statusReadInFlight: Promise<readonly WebStatusWidgetReading[]> | undefined;

/**
 * Reads every status widget, dropping any that cannot answer right now.
 *
 * Callers overlapping in time share one pass. The rail is polled on a bare
 * interval by every open tab and served concurrently, so two reads can be in
 * progress at once — and the cleanups below close resources the widgets share
 * (a database connection, typically). Run under each other, the first read's
 * teardown closes the connection the second is still querying: that read's
 * widgets throw, get dropped as unanswerable, and the rows vanish from the rail
 * with nothing logged. Sharing the pass also means the cleanups run once per
 * pass rather than once per caller.
 *
 * The in-flight promise is only cleared after the cleanups have finished, so a
 * read that starts later never overlaps an earlier one's teardown either.
 */
export function readWebStatusWidgets(): Promise<readonly WebStatusWidgetReading[]> {
  statusReadInFlight ??= readStatusWidgetsOnce().finally(() => {
    statusReadInFlight = undefined;
  });
  return statusReadInFlight;
}

async function readStatusWidgetsOnce(): Promise<readonly WebStatusWidgetReading[]> {
  try {
    const results = await Promise.all(
      statusWidgets.map(async (widget) => {
        try {
          return {
            id: widget.id,
            title: widget.title,
            source: widget.source,
            items: (await widget.read()).map((item) =>
              item.kind === "text" ? item : { ...item, kind: "meter" as const }
            ),
          };
        } catch {
          return undefined;
        }
      })
    );
    return results.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  } finally {
    // Close connections the widgets opened for this poll. A thrown cleanup
    // must not fail the rail: the numbers already landed, and a close error
    // is not something the operator can act on from this page.
    for (const cleanup of statusReadCleanups) {
      try {
        await cleanup();
      } catch {
        /* ignore */
      }
    }
  }
}

export function resetWebExtensionsForTesting(): void {
  panels.length = 0;
  fieldWidgets.clear();
  statusWidgets.length = 0;
  statusReadCleanups.length = 0;
}
