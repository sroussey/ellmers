/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CoveringIndexMissingError } from "./CoveringIndexMissingError";

export interface RegisteredIndex {
  readonly name: string;
  readonly keyPath: readonly string[];
}

export interface PickCoveringIndexInput {
  readonly table: string;
  readonly indexes: readonly RegisteredIndex[];
  readonly criteriaColumns: readonly string[];
  readonly orderByColumns: ReadonlyArray<{
    readonly column: string;
    readonly direction: "ASC" | "DESC";
  }>;
  readonly selectColumns: readonly string[];
  readonly primaryKeyColumns: readonly string[];
}

export interface PickedIndex {
  readonly name: string;
  readonly keyPath: readonly string[];
  /** true if the keypath order is reverse of orderBy direction (caller uses "prev" cursor) */
  readonly reverseDirection: boolean;
}

/**
 * Pick the first registered index whose keypath:
 *   1. starts with all `criteriaColumns` (as a prefix, in any order),
 *   2. then has the `orderByColumns` immediately after, in matching direction or reversed,
 *   3. and contains every `selectColumns` value somewhere in the keypath
 *      (primary-key columns are considered covered for free, e.g. via cursor.primaryKey).
 *
 * Throws {@link CoveringIndexMissingError} on no match.
 */
export function pickCoveringIndex(input: PickCoveringIndexInput): PickedIndex {
  const { table, indexes, criteriaColumns, orderByColumns, selectColumns, primaryKeyColumns } =
    input;
  const required = uniqueColumns([
    ...criteriaColumns,
    ...orderByColumns.map((o) => o.column),
    ...selectColumns,
  ]);
  const pkSet = new Set(primaryKeyColumns);

  for (const idx of indexes) {
    const fit = tryFitIndex(idx, criteriaColumns, orderByColumns, selectColumns, pkSet);
    if (fit !== undefined) {
      return { name: idx.name, keyPath: idx.keyPath, reverseDirection: fit.reverseDirection };
    }
  }

  throw new CoveringIndexMissingError(
    table,
    required,
    indexes.map((i) => i.keyPath)
  );
}

function tryFitIndex(
  index: RegisteredIndex,
  criteria: readonly string[],
  orderBy: ReadonlyArray<{ column: string; direction: "ASC" | "DESC" }>,
  select: readonly string[],
  pkSet: ReadonlySet<string>
): { reverseDirection: boolean } | undefined {
  const keyPath = index.keyPath;
  const criteriaSet = new Set(criteria);

  if (criteria.length > keyPath.length) return undefined;
  for (let i = 0; i < criteria.length; i++) {
    if (!criteriaSet.has(keyPath[i])) return undefined;
  }

  let reverseDirection = false;
  if (orderBy.length > 0) {
    const start = criteria.length;
    if (start + orderBy.length > keyPath.length) return undefined;
    for (let i = 0; i < orderBy.length; i++) {
      if (keyPath[start + i] !== orderBy[i].column) return undefined;
    }
    const allDesc = orderBy.every((o) => o.direction === "DESC");
    const allAsc = orderBy.every((o) => o.direction === "ASC");
    if (allDesc) reverseDirection = true;
    else if (!allAsc) return undefined;
  }

  const keyPathSet = new Set(keyPath);
  for (const col of select) {
    if (!keyPathSet.has(col) && !pkSet.has(col)) return undefined;
  }

  return { reverseDirection };
}

function uniqueColumns(cols: readonly string[]): string[] {
  return Array.from(new Set(cols));
}
