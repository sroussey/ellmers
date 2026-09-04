/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ValueOptionType } from "../tabular/ITabularStorage";

/**
 * A rendered predicate plus the parameters it binds, so the caller can keep
 * its own placeholder counter in step. `params.length` is the number of
 * placeholders consumed — which is NOT one per value for every dialect.
 */
export interface BuiltPredicate {
  readonly sql: string;
  readonly params: ValueOptionType[];
}

/**
 * Abstracts the dialect-specific differences between SQLite and PostgreSQL
 * for the parts of the storage layer that build SQL by string concatenation.
 *
 * The things that differ are:
 *   - Identifier quoting (backticks vs double quotes)
 *   - Parameter placeholders (`?` vs `$N`)
 *   - How a set-membership list is bound (expanded placeholders vs one array)
 *
 * Keeping these in one place lets the predicate builder, prefix DDL helpers
 * and migrations runner emit the same SQL shape against either backend.
 */
export interface ISqlDialect {
  readonly name: "sqlite" | "postgres";
  /** Quote a table or column identifier so it survives unsafe characters. */
  quoteId(id: string): string;
  /** Render a parameter placeholder for the given 1-based index. */
  placeholder(index: number): string;
  /**
   * Render a set-membership predicate for an already-quoted column.
   *
   * Dialects differ in how well they scale here, which is the whole reason
   * this is a dialect method rather than a shared `IN (?, ?, …)` string:
   * Postgres binds the list as ONE array parameter, so an IN-list of any
   * length costs one placeholder, while SQLite must expand one placeholder per
   * value and so remains subject to `SQLITE_MAX_VARIABLE_NUMBER`.
   *
   * An empty list yields an always-false predicate binding nothing — `IN ()`
   * is a syntax error in both dialects.
   */
  inPredicate(quotedColumn: string, values: ValueOptionType[], startIndex: number): BuiltPredicate;
  /**
   * Render a set-exclusion predicate for an already-quoted column — the
   * complement of {@link ISqlDialect.inPredicate}, with the same
   * one-placeholder-per-value vs. one-array-parameter split between dialects.
   *
   * An empty list yields an always-TRUE predicate, not an always-false one:
   * excluding nothing excludes nothing. That is the correct complement of the
   * empty `IN`, and it is why this cannot share `inPredicate`'s empty case.
   *
   * NULL handling is SQL's, deliberately: a NULL column never satisfies a
   * non-empty `NOT IN`, and a NULL among the values makes the predicate
   * UNKNOWN for every row. Backends that filter in JS get the same rules from
   * `matchesNotInCriterion`.
   */
  notInPredicate(
    quotedColumn: string,
    values: ValueOptionType[],
    startIndex: number
  ): BuiltPredicate;
}

/** Shared always-false predicate for an empty IN list. */
const NEVER: BuiltPredicate = { sql: "1 = 0", params: [] };

/** Shared always-true predicate for an empty NOT IN list. */
const ALWAYS: BuiltPredicate = { sql: "1 = 1", params: [] };

export const SqliteDialect: ISqlDialect = {
  name: "sqlite",
  quoteId(id: string): string {
    return "`" + id.replace(/`/g, "``") + "`";
  },
  placeholder(_index: number): string {
    return "?";
  },
  inPredicate(
    quotedColumn: string,
    values: ValueOptionType[],
    _startIndex: number
  ): BuiltPredicate {
    if (values.length === 0) return NEVER;
    // One placeholder per value: SQLite has no array parameter type. Callers
    // binding more values than SQLITE_MAX_VARIABLE_NUMBER (999 before SQLite
    // 3.32, 32766 after) must split the list themselves.
    return { sql: `${quotedColumn} IN (${values.map(() => "?").join(", ")})`, params: values };
  },
  notInPredicate(
    quotedColumn: string,
    values: ValueOptionType[],
    _startIndex: number
  ): BuiltPredicate {
    if (values.length === 0) return ALWAYS;
    return { sql: `${quotedColumn} NOT IN (${values.map(() => "?").join(", ")})`, params: values };
  },
};

export const PostgresDialect: ISqlDialect = {
  name: "postgres",
  quoteId(id: string): string {
    return '"' + id.replace(/"/g, '""') + '"';
  },
  placeholder(index: number): string {
    return `$${index}`;
  },
  inPredicate(quotedColumn: string, values: ValueOptionType[], startIndex: number): BuiltPredicate {
    if (values.length === 0) return NEVER;
    // `= ANY($n)` binds the whole list as a single array parameter, so the
    // 65535-parameter statement cap is irrelevant no matter how long the list
    // is. The driver infers the array element type from the column.
    return {
      sql: `${quotedColumn} = ANY($${startIndex})`,
      params: [values as unknown as ValueOptionType],
    };
  },
  notInPredicate(
    quotedColumn: string,
    values: ValueOptionType[],
    startIndex: number
  ): BuiltPredicate {
    if (values.length === 0) return ALWAYS;
    // `<> ALL($n)` is the array-parameter spelling of NOT IN, and carries the
    // identical three-valued semantics: UNKNOWN — so the row is dropped — when
    // the column is NULL or any array element is.
    return {
      sql: `${quotedColumn} <> ALL($${startIndex})`,
      params: [values as unknown as ValueOptionType],
    };
  },
};

/**
 * DuckDB speaks Postgres-flavoured SQL — same identifier quoting, same `$N`
 * placeholders — but its driver does not bind a JS array as a single LIST
 * parameter the way node-postgres does, so `= ANY($1)` is not available. IN
 * lists expand to one placeholder per value instead; everything else is the
 * Postgres dialect.
 */
export const DuckDbDialect: ISqlDialect = {
  name: "postgres",
  quoteId(id: string): string {
    return PostgresDialect.quoteId(id);
  },
  placeholder(index: number): string {
    return PostgresDialect.placeholder(index);
  },
  inPredicate(quotedColumn: string, values: ValueOptionType[], startIndex: number): BuiltPredicate {
    if (values.length === 0) return NEVER;
    const placeholders = values.map((_, i) => `$${startIndex + i}`).join(", ");
    return { sql: `${quotedColumn} IN (${placeholders})`, params: values };
  },
  notInPredicate(
    quotedColumn: string,
    values: ValueOptionType[],
    startIndex: number
  ): BuiltPredicate {
    if (values.length === 0) return ALWAYS;
    const placeholders = values.map((_, i) => `$${startIndex + i}`).join(", ");
    return { sql: `${quotedColumn} NOT IN (${placeholders})`, params: values };
  },
};
