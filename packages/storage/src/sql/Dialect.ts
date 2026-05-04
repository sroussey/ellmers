/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Abstracts the dialect-specific differences between SQLite and PostgreSQL
 * for the parts of the storage layer that build SQL by string concatenation.
 *
 * The two things that differ are:
 *   - Identifier quoting (backticks vs double quotes)
 *   - Parameter placeholders (`?` vs `$N`)
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
}

export const SqliteDialect: ISqlDialect = {
  name: "sqlite",
  quoteId(id: string): string {
    return "`" + id.replace(/`/g, "``") + "`";
  },
  placeholder(_index: number): string {
    return "?";
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
};
