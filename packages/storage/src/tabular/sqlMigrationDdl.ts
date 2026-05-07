/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PostgresDialect, SqliteDialect, type ISqlDialect } from "../sql/Dialect";

function selectDialect(name: "sqlite" | "postgres"): ISqlDialect {
  return name === "sqlite" ? SqliteDialect : PostgresDialect;
}

export function buildAddColumnSql(
  dialect: "sqlite" | "postgres",
  table: string,
  column: string,
  sqlType: string,
  nullable: boolean,
  hasDefault: boolean = false,
  defaultLiteralSql?: string
): string {
  const d = selectDialect(dialect);
  let sql = `ALTER TABLE ${d.quoteId(table)} ADD COLUMN ${d.quoteId(column)} ${sqlType}`;
  if (!nullable) sql += " NOT NULL";
  if (hasDefault && defaultLiteralSql !== undefined) {
    sql += ` DEFAULT ${defaultLiteralSql}`;
  }
  return sql;
}

export function buildDropColumnSql(
  dialect: "sqlite" | "postgres",
  table: string,
  column: string
): string {
  const d = selectDialect(dialect);
  return `ALTER TABLE ${d.quoteId(table)} DROP COLUMN ${d.quoteId(column)}`;
}

export function buildRenameColumnSql(
  dialect: "sqlite" | "postgres",
  table: string,
  from: string,
  to: string
): string {
  const d = selectDialect(dialect);
  return `ALTER TABLE ${d.quoteId(table)} RENAME COLUMN ${d.quoteId(from)} TO ${d.quoteId(to)}`;
}

export function buildAddIndexSql(
  dialect: "sqlite" | "postgres",
  table: string,
  indexName: string,
  columns: readonly string[],
  unique: boolean
): string {
  const d = selectDialect(dialect);
  const cols = columns.map((c) => d.quoteId(c)).join(", ");
  return (
    `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ` +
    `${d.quoteId(indexName)} ON ${d.quoteId(table)} (${cols})`
  );
}

export function buildDropIndexSql(dialect: "sqlite" | "postgres", indexName: string): string {
  const d = selectDialect(dialect);
  return `DROP INDEX IF EXISTS ${d.quoteId(indexName)}`;
}
