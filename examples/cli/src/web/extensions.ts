/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

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
export type PanelData =
  | {
      readonly kind: "table";
      readonly columns: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly kind: "kv"; readonly items: readonly (readonly [string, string])[] }
  | { readonly kind: "markdown"; readonly text: string }
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

export interface WebFieldWidget {
  /** Matches a schema `format`, which is how a field opts into a widget. */
  readonly format: string;
  readonly source: string;
  search(query: string): Promise<readonly WebFieldWidgetItem[]>;
}

export interface WebStatusMeter {
  readonly label: string;
  readonly value: number;
  readonly max: number;
}

export interface WebStatusWidget {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  read(): Promise<readonly WebStatusMeter[]>;
}

const panels: WebPanel[] = [];
const fieldWidgets = new Map<string, WebFieldWidget>();
const statusWidgets: WebStatusWidget[] = [];

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

export function listWebStatusWidgets(): readonly WebStatusWidget[] {
  return [...statusWidgets];
}

/** Reads every status widget, dropping any that cannot answer right now. */
export async function readWebStatusWidgets(): Promise<
  readonly {
    readonly id: string;
    readonly title: string;
    readonly source: string;
    readonly meters: readonly WebStatusMeter[];
  }[]
> {
  const results = await Promise.all(
    statusWidgets.map(async (widget) => {
      try {
        return {
          id: widget.id,
          title: widget.title,
          source: widget.source,
          meters: await widget.read(),
        };
      } catch {
        return undefined;
      }
    })
  );
  return results.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
}

export function resetWebExtensionsForTesting(): void {
  panels.length = 0;
  fieldWidgets.clear();
  statusWidgets.length = 0;
}
