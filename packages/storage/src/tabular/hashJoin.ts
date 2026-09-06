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
 * How much wider each successive left-side read is than the one before, when a
 * bounded join has not yet produced enough rows. Growing geometrically keeps
 * the number of round trips logarithmic in how selective the join turns out to
 * be, while a join that matches everything still reads only what it returns.
 */
const LEFT_READ_GROWTH = 4;

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
 *
 * A bounded join reads the left side in **growing prefixes** of that same
 * ordering and stops as soon as `offset + limit` joined rows exist, so a
 * `limit: 20` join does not have to materialise a million-row table first. It
 * can only do that when the joined rows are already in their final order — the
 * left query served the order, or none was asked for. An `orderBy` naming the
 * right side, or one the left query could not serve, is sorted here instead,
 * and that sort needs every row: such a join reads the whole left table.
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

  const offset = spec.offset ?? 0;
  const needed = spec.limit === undefined ? undefined : offset + spec.limit;
  // The joined rows are already in their final order — so the first `needed`
  // of them are the answer, and the read can stop once it has them — exactly
  // when nothing is sorted here afterwards.
  const boundLeftRead = needed !== undefined && (pushLeftOrder || orderBy.length === 0);

  const leftWhere = spec.where?.left;
  const hasLeftWhere = leftWhere !== undefined && Object.keys(leftWhere).length > 0;
  const readLeft = async (options: QueryOptions<L> | undefined): Promise<L[]> =>
    (hasLeftWhere
      ? await deps.leftQuery(leftWhere as SearchCriteria<L>, options)
      : await deps.leftGetAll(options)) ?? [];

  const leftColumns = spec.on.map((o) => o.left as string);
  const rightColumns = spec.on.map((o) => o.right as string);
  const joined: JoinedRow<L, R, T>[] = [];

  if (!boundLeftRead) {
    const leftRows = await readLeft(leftOptions);
    await appendJoinedRows(deps, spec, leftRows, leftColumns, rightColumns, joined);
  } else {
    const target = needed as number;
    // Each pass joins one left read whole, so what it produces is exactly what
    // the same unbounded join would have produced from that prefix — a widened
    // pass replaces the narrower one rather than extending it, which is what
    // keeps the result independent of how the backend broke ties in the
    // narrower read. A left join emits at least one row per left row, so its
    // first pass always suffices; an inner join drops unmatched left rows and
    // may have to widen.
    let batchLimit = target;
    let previousRead = -1;
    while (true) {
      const rows = await readLeft({ ...leftOptions, limit: batchLimit });
      joined.length = 0;
      await appendJoinedRows(deps, spec, rows, leftColumns, rightColumns, joined);
      // `rows.length <= previousRead` also covers a backend that ignores
      // `limit`: widening then reads no more than the pass before it did.
      if (joined.length >= target || rows.length < batchLimit || rows.length <= previousRead) {
        break;
      }
      previousRead = rows.length;
      batchLimit *= LEFT_READ_GROWTH;
    }
  }

  if (!pushLeftOrder && orderBy.length > 0) {
    sortJoinedRows(joined, orderBy);
  }

  if (offset === 0 && spec.limit === undefined) return joined;
  return joined.slice(offset, spec.limit === undefined ? undefined : offset + spec.limit);
}

/**
 * Fetches the right rows matching `leftRows` and appends the pairs to
 * `joined`, in left order. Under a `left` join an unmatched left row is
 * appended NULL-extended.
 */
async function appendJoinedRows<L, R, T extends JoinType>(
  deps: HashJoinDeps<L, R>,
  spec: JoinSpec<L, R, T>,
  leftRows: readonly L[],
  leftColumns: readonly string[],
  rightColumns: readonly string[],
  joined: JoinedRow<L, R, T>[]
): Promise<void> {
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
}
