/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { compareKeyValues } from "./cursorValues";
import type {
  JoinedRow,
  JoinOrderBy,
  JoinSpec,
  JoinType,
  QueryOptions,
  SearchCriteria,
} from "./ITabularStorage";
import { isSearchInCondition } from "./ITabularStorage";
import { pkFingerprint } from "./pkFingerprint";
import { StorageValidationError } from "./StorageError";

/**
 * How many distinct left-side key tuples one right-side `in` query carries.
 * SQLite binds one parameter per listed value, so an unbounded list would hit
 * `SQLITE_MAX_VARIABLE_NUMBER`; the same cap keeps an HTTP-proxied query body
 * a sane size.
 */
export const JOIN_IN_PARAM_BUDGET = 900;

/**
 * How many distinct key tuples one right-side `in` fetch may carry, given how
 * many join columns still need an `in` list. Each free column contributes its
 * own list, so the budget is divided between them — a flat cap would bind
 * `columns x tuples` parameters and blow the limit it exists to respect.
 * Mirrors the per-column division `SqliteTabularStorage.getBulk` already uses.
 */
export function joinInChunkSize(freeColumnCount: number): number {
  if (freeColumnCount <= 0) return JOIN_IN_PARAM_BUDGET;
  return Math.max(1, Math.floor(JOIN_IN_PARAM_BUDGET / freeColumnCount));
}

/**
 * Callbacks {@link runHashJoin} needs from the two storages. Bound to the
 * instances so a backend's own `query` override (mutex, transaction routing,
 * telemetry) still runs — the engine never reaches past the instance.
 *
 * @internal
 */
export interface HashJoinDeps<L, R> {
  readonly leftQuery: (
    criteria: SearchCriteria<L>,
    options?: QueryOptions<L>
  ) => Promise<L[] | undefined>;
  readonly leftGetAll: (options?: QueryOptions<L>) => Promise<L[] | undefined>;
  readonly rightQuery: (criteria: SearchCriteria<R>) => Promise<R[] | undefined>;
  /**
   * Whether a left column may hold null. Governs whether an `orderBy` can be
   * pushed into the left query, since the backends disagree with this module
   * on where nulls sort. Absent, no order is pushed down.
   */
  readonly leftColumnIsNullable?: (column: string) => boolean;
}

/**
 * Fingerprint of a row's join-key tuple, or `undefined` when any component is
 * `null` or absent — SQL never matches a NULL key, and neither does this.
 */
export function joinKeyFingerprint(
  row: Record<string, unknown>,
  columns: readonly string[]
): string | undefined {
  const values: unknown[] = [];
  for (const column of columns) {
    const value = row[column];
    if (value === null || value === undefined) return undefined;
    values.push(value);
  }
  return pkFingerprint(values);
}

/**
 * Sorts joined rows in place. Uses the same comparison as single-table
 * in-memory sorting, so NULLs (and a missing right side) sort first under ASC
 * and last under DESC — the rule the SQL path spells out as `NULLS FIRST` /
 * `NULLS LAST`.
 */
export function sortJoinedRows<L, R, T extends JoinType>(
  rows: JoinedRow<L, R, T>[],
  orderBy: ReadonlyArray<JoinOrderBy>
): JoinedRow<L, R, T>[] {
  const valueOf = (row: JoinedRow<L, R, T>, o: JoinOrderBy): unknown => {
    const side = o.side === "left" ? row.left : row.right;
    return side === undefined ? null : (side as Record<string, unknown>)[o.column];
  };
  rows.sort((a, b) => {
    for (const o of orderBy) {
      let cmp: number;
      try {
        cmp = compareKeyValues(valueOf(a, o), valueOf(b, o));
      } catch (error) {
        // `compareKeyValues` is the cursor comparator and refuses bigint and
        // non-primitive values in cursor vocabulary. A join never paginated,
        // so say what the caller actually did wrong.
        throw new StorageValidationError(
          `Cannot order a join by ${o.side} column "${o.column}": its values are not ` +
            `comparable (bigint, binary and object columns are not orderable). ` +
            `Underlying reason: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (cmp !== 0) return o.direction === "ASC" ? cmp : -cmp;
    }
    return 0;
  });
  return rows;
}

/**
 * Application-side hash join: read the left rows, fetch the right rows whose
 * key is among them in one `in` query per chunk, and pair them up in memory.
 * This is the join every backend gets for free; SQL backends replace it with
 * a single statement when both tables share a connection.
 *
 * Only `orderBy` is pushed down to the left query, and only when every entry
 * is on the left side. `limit` and `offset` are always applied to the joined
 * rows: pushing them to the left query would under-produce under an inner
 * join (unmatched left rows drop out) and over-produce against a one-to-many
 * right side.
 */
export async function runHashJoin<L, R, T extends JoinType>(
  deps: HashJoinDeps<L, R>,
  spec: JoinSpec<L, R, T>
): Promise<JoinedRow<L, R, T>[]> {
  const orderBy = spec.orderBy ?? [];
  // A pushed-down order is served by the backend's own ORDER BY, and neither
  // SQLite's nor Postgres's single-table read emits a NULLS clause — so the
  // backend default applies (Postgres puts nulls LAST for ASC) and contradicts
  // the nulls-first-for-ASC rule both the SQL join and the in-memory sort
  // below follow. Push the order down only when no ordered column can be null,
  // which is the case where the two agree.
  const pushLeftOrder =
    orderBy.length > 0 &&
    orderBy.every((o) => o.side === "left" && deps.leftColumnIsNullable?.(o.column) !== true);
  const leftOptions: QueryOptions<L> | undefined = pushLeftOrder
    ? { orderBy: orderBy.map((o) => ({ column: o.column as keyof L, direction: o.direction })) }
    : undefined;

  // A left join emits at least one row per left row, in left order, so the
  // first `offset + limit` joined rows can only come from the first
  // `offset + limit` left rows — the read can stop there. This is exact only
  // for a left join whose order is fully pushed down: an inner join drops
  // unmatched left rows, so bounding its left read would under-produce.
  // (Over-production against a one-to-many right side is harmless; the slice
  // at the end trims it.)
  const boundedLeft =
    pushLeftOrder && spec.type === "left" && spec.limit !== undefined
      ? { ...leftOptions, limit: (spec.offset ?? 0) + spec.limit }
      : leftOptions;

  const leftWhere = spec.where?.left;
  const leftRows =
    (leftWhere !== undefined && Object.keys(leftWhere).length > 0
      ? await deps.leftQuery(leftWhere, boundedLeft)
      : await deps.leftGetAll(boundedLeft)) ?? [];

  const leftColumns = spec.on.map((o) => o.left as string);
  const rightColumns = spec.on.map((o) => o.right as string);

  // Distinct key tuples, in first-seen order, and each left row's fingerprint.
  const tuples = new Map<string, unknown[]>();
  const leftKeys = leftRows.map((row) => {
    const record = row as Record<string, unknown>;
    const fp = joinKeyFingerprint(record, leftColumns);
    if (fp !== undefined && !tuples.has(fp)) {
      tuples.set(
        fp,
        leftColumns.map((c) => record[c])
      );
    }
    return fp;
  });

  const rightByKey = new Map<string, R[]>();
  if (tuples.size > 0) {
    const rightWhere = (spec.where?.right ?? {}) as Record<string, unknown>;
    // A caller's own criterion on a join column is kept as written; the
    // tuple post-filter below still makes the result exact.
    // A join column the caller also filters cannot carry two criteria at once.
    // When theirs is an `in` the two lists are intersected, which keeps the key
    // restriction; for any other operator theirs wins and this column stops
    // narrowing the fetch (the tuple post-filter still makes the result exact).
    const callerInList = (column: string): readonly unknown[] | undefined => {
      const criterion = rightWhere[column];
      return isSearchInCondition(criterion) ? criterion.value : undefined;
    };
    const freeColumns = rightColumns
      .map((column, index) => ({ column, index }))
      .filter(
        ({ column }) => !Object.hasOwn(rightWhere, column) || callerInList(column) !== undefined
      );
    const tupleList = [...tuples.entries()];
    // With no free join column there is nothing to chunk by: one fetch serves
    // every tuple.
    const chunkSize =
      freeColumns.length === 0 ? tupleList.length : joinInChunkSize(freeColumns.length);

    for (let start = 0; start < tupleList.length; start += chunkSize) {
      const chunk = tupleList.slice(start, start + chunkSize);
      const wanted = new Set(chunk.map(([fp]) => fp));
      const criteria: Record<string, unknown> = { ...rightWhere };
      for (const { column, index } of freeColumns) {
        const distinct = new Set(chunk.map(([, tuple]) => tuple[index]));
        const callers = callerInList(column);
        const values =
          callers === undefined ? [...distinct] : [...distinct].filter((v) => callers.includes(v));
        criteria[column] = { value: values, operator: "in" };
      }
      const rows = (await deps.rightQuery(criteria as SearchCriteria<R>)) ?? [];
      for (const row of rows) {
        // A compound key fetches the cross product of its per-column lists;
        // keep only rows whose whole tuple was asked for by THIS chunk, so a
        // row cannot be admitted twice across chunks.
        const fp = joinKeyFingerprint(row as Record<string, unknown>, rightColumns);
        if (fp === undefined || !wanted.has(fp)) continue;
        const bucket = rightByKey.get(fp);
        if (bucket === undefined) rightByKey.set(fp, [row]);
        else bucket.push(row);
      }
    }
  }

  const joined: JoinedRow<L, R, T>[] = [];
  leftRows.forEach((left, i) => {
    const fp = leftKeys[i];
    const matches = fp === undefined ? undefined : rightByKey.get(fp);
    if (matches !== undefined) {
      for (const right of matches) {
        joined.push({ left, right } as JoinedRow<L, R, T>);
      }
    } else if (spec.type === "left") {
      joined.push({ left, right: undefined } as JoinedRow<L, R, T>);
    }
  });

  if (!pushLeftOrder && orderBy.length > 0) {
    sortJoinedRows(joined, orderBy);
  }

  const offset = spec.offset ?? 0;
  if (offset === 0 && spec.limit === undefined) return joined;
  return joined.slice(offset, spec.limit === undefined ? undefined : offset + spec.limit);
}
