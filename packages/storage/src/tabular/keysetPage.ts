/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CursorPayload, PageCursor } from "./Cursor";
import { assertCursorMatches, decodeCursor, encodeCursor } from "./Cursor";
import { compareKeyValues, toCursorValue } from "./cursorValues";
import type {
  OrderBy,
  Page,
  PageRequest,
  QueryOptions,
  SearchCondition,
  SearchCriteria,
} from "./ITabularStorage";
import { StorageUnsupportedError } from "./StorageError";

/**
 * Callbacks {@link runKeysetPage} needs from the storage instance driving the
 * page. Every entry is bound to that instance so a subclass override of
 * `query`, `getAll`, `sortInMemory`, `buildCursor` (and friends) still wins —
 * the engine must never reach past the instance into a sibling helper.
 *
 * @internal
 */
export interface KeysetPageDeps<Entity> {
  readonly validatePageRequest: (request: PageRequest<Entity>) => void;
  readonly primaryKeyColumns: () => Array<keyof Entity>;
  readonly buildEffectiveOrderBy: (
    orderBy: ReadonlyArray<OrderBy<Entity>> | undefined,
    pkColumns: ReadonlyArray<keyof Entity>
  ) => ReadonlyArray<OrderBy<Entity>>;
  readonly sortInMemory: (rows: Entity[], orderBy: ReadonlyArray<OrderBy<Entity>>) => Entity[];
  readonly applyKeysetFilter: (
    rows: Entity[],
    cursor: CursorPayload,
    effectiveOrderBy: ReadonlyArray<OrderBy<Entity>>,
    pkColumns: ReadonlyArray<keyof Entity>
  ) => Entity[];
  readonly buildCursor: (
    row: Entity,
    effectiveOrderBy: ReadonlyArray<OrderBy<Entity>>
  ) => PageCursor;
  readonly getAll: (options?: QueryOptions<Entity>) => Promise<Entity[] | undefined>;
  readonly query: (
    criteria: SearchCriteria<Entity>,
    options?: QueryOptions<Entity>
  ) => Promise<Entity[] | undefined>;
}

/**
 * Returns the order spec actually used to drive a keyset page: the
 * caller's `orderBy` (if any) followed by every primary-key column as a
 * stable tiebreaker. PK columns are appended in ASC direction unless the
 * caller already specified a direction for them.
 */
export function buildEffectiveOrderBy<Entity>(
  orderBy: ReadonlyArray<OrderBy<Entity>> | undefined,
  pkColumns: ReadonlyArray<keyof Entity>
): ReadonlyArray<OrderBy<Entity>> {
  const result: OrderBy<Entity>[] = orderBy ? orderBy.slice() : [];
  const seen = new Set(result.map((o) => o.column));
  for (const pk of pkColumns) {
    if (!seen.has(pk)) {
      result.push({ column: pk, direction: "ASC" });
    }
  }
  return result;
}

/**
 * Sorts rows in place by the given order spec, using the same null-first
 * comparison rules as the cursor filter so results are consistent.
 */
export function sortInMemory<Entity>(
  rows: Entity[],
  orderBy: ReadonlyArray<OrderBy<Entity>>
): Entity[] {
  rows.sort((a, b) => {
    for (const { column, direction } of orderBy) {
      // `compareKeyValues` runs each side through `toCursorValue`, so
      // we don't need (and shouldn't) coerce types here — passing the
      // raw row value lets `Date` (and any other type the encoder
      // supports) compare correctly against a decoded cursor value.
      const cmp = compareKeyValues(a[column], b[column]);
      if (cmp !== 0) return direction === "ASC" ? cmp : -cmp;
    }
    return 0;
  });
  return rows;
}

/**
 * In-memory keyset filter: drops rows that come at or before the cursor
 * row according to `orderBy + primaryKey`.
 */
export function applyKeysetFilter<Entity>(
  rows: Entity[],
  cursor: CursorPayload,
  effectiveOrderBy: ReadonlyArray<OrderBy<Entity>>
): Entity[] {
  return rows.filter((row) => {
    for (let i = 0; i < effectiveOrderBy.length; i++) {
      const { column, direction } = effectiveOrderBy[i];
      // `compareKeyValues` normalises both sides through `toCursorValue`,
      // so passing the raw row value here lets a `Date` row column be
      // compared against the decoded ISO string in the cursor without a
      // type-mismatch surprise.
      const cmp = compareKeyValues(row[column], cursor.c[i]);
      if (cmp === 0) continue;
      return direction === "ASC" ? cmp > 0 : cmp < 0;
    }
    return false; // exact-match row was already returned in the prior page
  });
}

/**
 * Encodes the position of `row` as an opaque cursor, writing one value per
 * effective ordering column, in the same order.
 */
export function buildCursor<Entity>(
  row: Entity,
  effectiveOrderBy: ReadonlyArray<OrderBy<Entity>>
): PageCursor {
  const n = effectiveOrderBy.map((spec) => String(spec.column));
  const d = effectiveOrderBy.map((spec): "a" | "d" => (spec.direction === "ASC" ? "a" : "d"));
  const c = effectiveOrderBy.map((spec) => toCursorValue(row[spec.column]));
  return encodeCursor({ v: 1, n, d, c });
}

/**
 * Shared keyset-pagination engine backing both `getPage` and `queryPage`.
 * Translates the cursor into AND criteria using the primary key column(s)
 * and runs the existing `query`/`getAll` machinery through {@link deps},
 * then re-encodes the position of the last returned row.
 *
 * For composite primary keys this performs the keyset comparison in
 * memory after fetching a candidate window. SQL backends should override
 * `getPage`/`queryPage` to push it down to the database.
 *
 * @internal
 */
export async function runKeysetPage<Entity>(
  deps: KeysetPageDeps<Entity>,
  criteria: SearchCriteria<Entity> | undefined,
  request: PageRequest<Entity>
): Promise<Page<Entity>> {
  deps.validatePageRequest(request);
  const limit = request.limit ?? 100;

  const pkColumns = deps.primaryKeyColumns();
  const orderBy = request.orderBy;
  const effectiveOrderBy = deps.buildEffectiveOrderBy(orderBy, pkColumns);
  const effectiveOrderForCursor = effectiveOrderBy.map((o) => ({
    column: String(o.column),
    direction: o.direction,
  }));

  let cursorPayload: CursorPayload | undefined;
  if (request.cursor !== undefined) {
    cursorPayload = decodeCursor(request.cursor);
    assertCursorMatches(cursorPayload, effectiveOrderForCursor);
  }

  const pkCol = pkColumns[0];
  const userCriteria = criteria ?? ({} as SearchCriteria<Entity>);
  const userTouchesPk =
    pkColumns.length === 1 && Object.prototype.hasOwnProperty.call(userCriteria, pkCol);

  // The simple-keyset path pushes one `pk OP ?` predicate into `query()`.
  // It works whenever the effective ordering is exactly "primary key in
  // some direction" — that's true both when the caller passed no orderBy
  // (we default to PK ASC) and when they passed exactly the primary key
  // themselves (any direction). We still bail out if the caller already
  // has a criterion on the PK column, because we'd otherwise overwrite it.
  const canPushKeyset =
    pkColumns.length === 1 &&
    effectiveOrderBy.length === 1 &&
    effectiveOrderBy[0].column === pkCol &&
    !userTouchesPk;

  let queryCriteria: SearchCriteria<Entity> = userCriteria;
  // Three pushdown tiers, in decreasing precision:
  //
  //   1. Simple keyset (`canPushKeyset` true): the effective ordering is
  //      a single PK column, so one `pk OP ?` inequality is exactly the
  //      keyset filter. Backend returns at most `limit` correct rows.
  //
  //   2. Leading-column pushdown (the fallback below): the effective
  //      ordering is compound (or non-PK + PK tiebreaker). We can't
  //      express the full keyset through `query()` (which is AND-only),
  //      but we *can* push the leading column's inequality to prune the
  //      bulk of the table, then sort and apply the full multi-column
  //      keyset in memory. Bounded fetch as long as the leading column
  //      isn't degenerate (single value across the whole table).
  //
  //   3. Full scan (last resort): leading column has a NULL cursor value
  //      we can't express, or the user already filters on that column,
  //      or there's no cursor (page 1). We fetch everything, sort, slice.
  //      Backends with tuple comparison should override `getPage` to
  //      avoid this.
  const useFallback = !canPushKeyset;

  if (cursorPayload && canPushKeyset) {
    const direction = effectiveOrderBy[0].direction;
    const op = direction === "ASC" ? ">" : "<";
    // canPushKeyset implies a single-column PK as the only effective
    // ordering, so cursorPayload has exactly one entry and `c[0]` is the
    // last seen PK value. PK columns are NOT NULL so there's no need for
    // the IS NULL gymnastics the SQL/in-memory keyset paths handle.
    // The simple-keyset path's correctness depends on the backend's
    // `query()` calling `jsToSqlValue` (or equivalent) on the
    // SearchCondition value — every concrete backend in this monorepo
    // does, but a third-party backend would need to as well.
    const lastPk = cursorPayload.c[0] as Entity[keyof Entity];
    const keysetCondition: SearchCondition<Entity[keyof Entity]> = {
      value: lastPk,
      operator: op,
    };
    queryCriteria = {
      ...userCriteria,
      [pkCol]: keysetCondition,
    } as SearchCriteria<Entity>;
  } else if (cursorPayload && useFallback) {
    // Tier 2: prune the bulk of the table by pushing the leading
    // ordering column's inequality into `query()`. We push only for
    // ASC because:
    //   - ASC NULLs-first: rows `>= cursor[0]` include the cursor row
    //     plus anything strictly greater; the in-memory keyset filter
    //     then drops the cursor row and any earlier-on-tiebreaker rows.
    //     NULL rows (which sort before in ASC NULLs-first) are
    //     correctly excluded by `>=` because SQL `null >= x` is null.
    //   - DESC NULLs-last would need `(col <= ? OR col IS NULL)` to
    //     keep the NULL trailer rows that sort *after* the cursor.
    //     `query()` is AND-only and can't express the OR, so pushing
    //     `col <= ?` would silently drop the NULL trailer. We fall
    //     through to a full scan instead — slower, but correct on
    //     nullable DESC orderings. SQL backends override `getPage`
    //     entirely so they don't pay this price.
    // Skipped when the user already filters on the leading column
    // (we'd trample their criterion) or the cursor's leading value
    // is NULL (no representable `col > NULL` in NULLs-first ASC).
    const leading = effectiveOrderBy[0];
    const leadingCol = leading.column;
    const leadingCursor = cursorPayload.c[0];
    const userTouchesLeading = Object.prototype.hasOwnProperty.call(userCriteria, leadingCol);
    if (leading.direction === "ASC" && leadingCursor !== null && !userTouchesLeading) {
      const leadingCondition: SearchCondition<Entity[keyof Entity]> = {
        value: leadingCursor as Entity[keyof Entity],
        operator: ">=",
      };
      queryCriteria = {
        ...userCriteria,
        [leadingCol]: leadingCondition,
      } as SearchCriteria<Entity>;
    }
  }

  const fetchLimit = useFallback ? undefined : limit;

  const queryOptions: QueryOptions<Entity> = {
    orderBy: effectiveOrderBy,
    ...(fetchLimit !== undefined ? { limit: fetchLimit } : {}),
  };

  let rows: Entity[] | undefined;
  // Tracks whether we wound up using `getAll()` because `query()` was
  // unsupported and we fell back. In that case the backend never
  // applied our keyset / leading-column predicate, so we must drive
  // the in-memory sort + keyset filter ourselves even if `useFallback`
  // is false (which it would be when the *simple-keyset* path tried to
  // push `pk OP ?` to `query()` and got rejected — without this flag
  // the cursor predicate would never run and pages would repeat rows).
  let forcedFallback = false;
  if (Object.keys(queryCriteria).length === 0) {
    rows = await deps.getAll(queryOptions);
  } else {
    try {
      rows = await deps.query(queryCriteria, queryOptions);
    } catch (err) {
      // Backends like FsFolder don't implement `query()`. Falling back
      // to a full scan keeps the call correct as long as we then sort
      // and filter in memory ourselves. User-supplied criteria still
      // need to fail loudly, so we only swallow the error when we'd
      // added our own pushdown criterion AND the user passed none.
      const userHadNoCriteria = !criteria || Object.keys(criteria).length === 0;
      if (err instanceof StorageUnsupportedError && userHadNoCriteria) {
        rows = await deps.getAll({ orderBy: effectiveOrderBy });
        forcedFallback = true;
      } else {
        throw err;
      }
    }
  }

  let items: Entity[] = rows ?? [];

  if (useFallback || forcedFallback) {
    // Keyset paging requires rows to be seen in a definite order. Some
    // backends don't honour `orderBy` reliably (FsFolder, certain remote
    // services), so we re-sort here to guarantee correctness rather than
    // trust the backend.
    items = deps.sortInMemory(items.slice(), effectiveOrderBy);
    if (cursorPayload) {
      items = deps.applyKeysetFilter(items, cursorPayload, effectiveOrderBy, pkColumns);
    }
  }

  if (items.length > limit) {
    items = items.slice(0, limit);
  }

  const nextCursor =
    items.length === limit
      ? deps.buildCursor(items[items.length - 1], effectiveOrderBy)
      : undefined;

  return { items, nextCursor };
}
