/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqlDialect } from "./Dialect";

/**
 * Minimal column descriptor used by the prefix-DDL helpers. This mirrors the
 * `PrefixColumn` shape that backends like the job queue and rate limiter use,
 * without forcing `@workglow/storage` to take a dependency on those packages.
 *
 * Backends that have their own `PrefixColumn`-like type pass instances of it
 * directly — the structural match is enough.
 */
export interface ISqlPrefixColumn {
  readonly name: string;
  readonly type: "uuid" | "number";
}

/**
 * Regex for safe SQL identifiers used in prefix column DDL: must start with a
 * letter and contain only letters, digits, and underscores. Prefix names are
 * spliced into CREATE TABLE / CREATE INDEX statements without parameterisation,
 * so they MUST be validated before use.
 */
const SAFE_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Throws if any prefix column name would be unsafe to splice into DDL.
 *
 * Every helper in this module that splices `prefix.name` into SQL calls this
 * first, so storage backends don't need to remember to validate at construction
 * time — but doing so up front still surfaces invalid configurations earlier.
 */
export function assertPrefixesSafe(prefixes: readonly ISqlPrefixColumn[]): void {
  for (const p of prefixes) {
    if (!SAFE_IDENTIFIER.test(p.name)) {
      throw new Error(
        `Prefix column name must start with a letter and contain only letters, digits, and underscores, got: ${p.name}`
      );
    }
  }
}

/**
 * Throws if any declared prefix column lacks a value in `prefixValues`.
 *
 * Prefix columns are declared `NOT NULL` in the DDL helpers; binding
 * `undefined` for them later yields opaque database errors ("invalid input
 * syntax for type X" / "null value violates not-null constraint"). Catch the
 * misconfiguration at the call site instead.
 */
export function assertPrefixValuesPresent(
  prefixes: readonly ISqlPrefixColumn[],
  prefixValues: Readonly<Record<string, string | number>>
): void {
  for (const p of prefixes) {
    const v = prefixValues[p.name];
    if (v === undefined || v === null) {
      throw new Error(
        `Missing prefix value for column "${p.name}". Every prefix declared in \`prefixes\` ` +
          `must have a corresponding entry in \`prefixValues\`.`
      );
    }
  }
}

/** Returns the SQL column type for a {@link ISqlPrefixColumn} on the given dialect. */
export function prefixColumnType(dialect: ISqlDialect, type: ISqlPrefixColumn["type"]): string {
  if (type === "uuid") {
    return dialect.name === "postgres" ? "UUID" : "TEXT";
  }
  return "INTEGER";
}

/**
 * Builds the prefix portion of a CREATE TABLE column list, e.g.
 * `tenant_id UUID NOT NULL,\n  project_id INTEGER NOT NULL,\n  `
 *
 * Returns an empty string when there are no prefixes so callers can splice it
 * directly into a column list without a trailing comma.
 */
export function buildPrefixColumnsSql(
  dialect: ISqlDialect,
  prefixes: readonly ISqlPrefixColumn[]
): string {
  if (prefixes.length === 0) return "";
  assertPrefixesSafe(prefixes);
  return (
    prefixes
      .map((p) => `${p.name} ${prefixColumnType(dialect, p.type)} NOT NULL`)
      .join(",\n        ") + ",\n        "
  );
}

/** Returns prefix column names in declaration order. */
export function getPrefixColumnNames(prefixes: readonly ISqlPrefixColumn[]): string[] {
  return prefixes.map((p) => p.name);
}

/**
 * Comma-joined prefix column list with a trailing `, ` for index/insert use,
 * or an empty string when there are no prefixes.
 */
export function getPrefixIndexPrefix(prefixes: readonly ISqlPrefixColumn[]): string {
  if (prefixes.length === 0) return "";
  assertPrefixesSafe(prefixes);
  return prefixes.map((p) => p.name).join(", ") + ", ";
}

/** Returns the index-name suffix derived from prefix columns. */
export function getPrefixIndexSuffix(prefixes: readonly ISqlPrefixColumn[]): string {
  if (prefixes.length === 0) return "";
  assertPrefixesSafe(prefixes);
  return "_" + prefixes.map((p) => p.name).join("_");
}

/**
 * Builds an ` AND col1 = ? AND col2 = ?` (or `$N` for Postgres) suffix.
 *
 * @param startParam 1-based starting parameter index (Postgres only — SQLite
 *                   placeholders are positional and ignore this).
 */
export function buildPrefixWhereClause(
  dialect: ISqlDialect,
  prefixes: readonly ISqlPrefixColumn[],
  prefixValues: Readonly<Record<string, string | number>>,
  startParam: number = 1
): { conditions: string; params: Array<string | number> } {
  if (prefixes.length === 0) return { conditions: "", params: [] };
  assertPrefixesSafe(prefixes);
  assertPrefixValuesPresent(prefixes, prefixValues);
  const conditions = prefixes
    .map((p, i) => `${p.name} = ${dialect.placeholder(startParam + i)}`)
    .join(" AND ");
  const params = prefixes.map((p) => prefixValues[p.name]);
  return { conditions: " AND " + conditions, params };
}

/** Returns prefix values in column order for binding to placeholders. */
export function getPrefixParamValues(
  prefixes: readonly ISqlPrefixColumn[],
  prefixValues: Readonly<Record<string, string | number>>
): Array<string | number> {
  if (prefixes.length === 0) return [];
  assertPrefixValuesPresent(prefixes, prefixValues);
  return prefixes.map((p) => prefixValues[p.name]);
}

/**
 * Builds the prefix-portion of an INSERT column list and its placeholder list,
 * starting at parameter index `startParam`. Returns empty strings when there
 * are no prefixes so callers can concatenate without a trailing comma.
 */
export function buildPrefixInsertFragments(
  dialect: ISqlDialect,
  prefixes: readonly ISqlPrefixColumn[],
  startParam: number = 1
): { columns: string; placeholders: string } {
  if (prefixes.length === 0) return { columns: "", placeholders: "" };
  assertPrefixesSafe(prefixes);
  const columns = prefixes.map((p) => p.name).join(", ") + ", ";
  const placeholders =
    prefixes.map((_, i) => dialect.placeholder(startParam + i)).join(", ") + ", ";
  return { columns, placeholders };
}
