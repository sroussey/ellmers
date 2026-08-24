/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebCommandNode } from "./commandTree";

/**
 * What a downstream package says ABOUT a command or a field it already has.
 *
 * The other seams contribute new surface — a panel, a widget, a schema. This
 * one annotates surface that already exists, which is what a commander-based
 * CLI needs: `sec query facts <cik>` declares a positional string, and nothing
 * in commander can say that the string is a CIK, that a picker exists for it,
 * or that `db reset` drops tables. Every field of an annotation is optional and
 * additive, so a command nobody annotates renders exactly as it does today.
 */

/** Tones a badge or a status line can carry. Rendered, never interpreted. */
export type WebTone = "ok" | "warn" | "fail" | "info" | "idle";

/**
 * What running this command costs, in the terms an operator weighs before
 * pressing a button they cannot take back.
 *
 * `ai` spends model quota, `network` goes out to a rate-limited third party,
 * `slow` runs longer than someone will sit and watch, `writes` changes stored
 * data, and `destructive` destroys some of it. They compose: a backfill is
 * every one of them at once.
 */
export const COMMAND_BADGES = ["ai", "network", "slow", "writes", "destructive"] as const;
export type WebCommandBadge = (typeof COMMAND_BADGES)[number];

export interface WebCommandAnnotation {
  /**
   * Command path to match. A `"*"` segment matches exactly one segment and a
   * trailing `"**"` matches the rest, so `["version", "**"]` covers a group
   * without restating its leaves.
   */
  readonly path: readonly string[];
  /** Package name, so an annotation says who owns it. */
  readonly source: string;
  readonly badges?: readonly WebCommandBadge[];
  /** One line shown above the form: what this run will actually do. */
  readonly note?: string;
  /**
   * Text of a confirmation the page requires before it will start a run.
   *
   * Reserved for a command whose damage survives the run — dropping a version
   * slot, resetting a database. A run that merely costs money says so with the
   * `ai` badge instead; a dialog on every extraction is a dialog nobody reads.
   */
  readonly confirm?: string;
}

export interface WebFieldAnnotation {
  /**
   * The widget hook. Names a `WebFieldWidget` format, which is how a positional
   * argument gets the picker a schema field gets from its own `format`.
   */
  readonly format?: string;
  readonly label?: string;
  readonly description?: string;
  readonly choices?: readonly string[];
  readonly placeholder?: string;
  /** Moves a field behind the fold, or pulls one out from behind it. */
  readonly advanced?: boolean;
  /**
   * The field takes a comma-separated list, so picking from the widget appends
   * rather than replaces. `--models` names several models; `--cik` names one.
   */
  readonly multiple?: boolean;
}

export interface CommandFieldAnnotations {
  /** Same matching rules as {@link WebCommandAnnotation.path}. */
  readonly path: readonly string[];
  readonly source: string;
  /** Keyed by field key: an argument's name, or an option's long flag. */
  readonly fields: Readonly<Record<string, WebFieldAnnotation>>;
}

const commandAnnotations: WebCommandAnnotation[] = [];
const fieldAnnotations: CommandFieldAnnotations[] = [];

/**
 * Whether a pattern matches a path, and how specifically.
 *
 * Returns the number of literal segments matched, or -1 for no match, so the
 * caller can apply the general annotation before the particular one and let
 * the particular one win.
 */
export function matchPathSpecificity(pattern: readonly string[], path: readonly string[]): number {
  let literals = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];
    if (segment === "**") return literals;
    if (index >= path.length) return -1;
    if (segment === "*") continue;
    if (segment !== path[index]) return -1;
    literals += 1;
  }
  return pattern.length === path.length ? literals : -1;
}

function matching<T extends { readonly path: readonly string[] }>(
  entries: readonly T[],
  path: readonly string[]
): T[] {
  return entries
    .map((entry) => ({ entry, rank: matchPathSpecificity(entry.path, path) }))
    .filter((candidate) => candidate.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((candidate) => candidate.entry);
}

export function registerCommandAnnotation(annotation: WebCommandAnnotation): void {
  const key = annotation.path.join(" ");
  const at = commandAnnotations.findIndex((entry) => entry.path.join(" ") === key);
  if (at >= 0) commandAnnotations[at] = annotation;
  else commandAnnotations.push(annotation);
}

export function registerCommandFieldAnnotations(annotations: CommandFieldAnnotations): void {
  const key = annotations.path.join(" ");
  const at = fieldAnnotations.findIndex((entry) => entry.path.join(" ") === key);
  if (at >= 0) fieldAnnotations[at] = annotations;
  else fieldAnnotations.push(annotations);
}

/** The badges, note and confirmation that apply to one command path. */
export function resolveCommandAnnotation(path: readonly string[]): {
  readonly badges: readonly WebCommandBadge[];
  readonly note: string | undefined;
  readonly confirm: string | undefined;
} {
  const badges = new Set<WebCommandBadge>();
  let note: string | undefined;
  let confirm: string | undefined;
  for (const annotation of matching(commandAnnotations, path)) {
    for (const badge of annotation.badges ?? []) badges.add(badge);
    if (annotation.note !== undefined) note = annotation.note;
    if (annotation.confirm !== undefined) confirm = annotation.confirm;
  }
  return { badges: [...badges], note, confirm };
}

/** The annotations for one command's fields, keyed by field key. */
export function resolveFieldAnnotations(
  path: readonly string[]
): ReadonlyMap<string, WebFieldAnnotation> {
  const merged = new Map<string, WebFieldAnnotation>();
  for (const entry of matching(fieldAnnotations, path)) {
    for (const [key, annotation] of Object.entries(entry.fields)) {
      merged.set(key, { ...merged.get(key), ...annotation });
    }
  }
  return merged;
}

/**
 * Decorates a command tree with its annotations, in place of the caller
 * walking it. Applied where the tree is served rather than where it is built,
 * so `buildCommandTree` stays a pure reading of the commander program.
 */
export function annotateCommandTree(nodes: readonly WebCommandNode[]): readonly WebCommandNode[] {
  return nodes.map((node) => {
    const { badges, note, confirm } = resolveCommandAnnotation(node.path);
    return {
      ...node,
      children: annotateCommandTree(node.children),
      ...(badges.length > 0 ? { badges } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(confirm !== undefined ? { confirm } : {}),
    };
  });
}

export function resetWebAnnotationsForTesting(): void {
  commandAnnotations.length = 0;
  fieldAnnotations.length = 0;
}
