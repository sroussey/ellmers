/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type DeleteSearchCriteria,
  isSearchCondition,
  type SearchOperator,
  type ValueOptionType,
} from "../tabular/ITabularStorage";
import type { ISqlDialect } from "./Dialect";

/**
 * Result of {@link buildSearchWhere} — a parameterized WHERE-clause body
 * (without the leading `WHERE` keyword) and its ordered parameters.
 */
export interface BuiltWhereClause {
  readonly whereClause: string;
  readonly params: ValueOptionType[];
}

/**
 * Builds a parameterized AND-joined WHERE clause from a {@link DeleteSearchCriteria}.
 * Used by every SQL tabular backend so the operator handling stays consistent.
 *
 * @param dialect       Identifier-quoting + placeholder rules for the target DB.
 * @param criteria      Per-column equality value or {@link SearchOperator} condition.
 * @param schemaProps   Schema property bag — unknown columns throw, preventing
 *                      callers from accidentally letting user input pick a column.
 * @param convertValue  Backend-specific JS-to-SQL coercion (e.g. boolean → 0/1).
 * @param startIndex    1-based starting parameter index (defaults to 1).
 *                      PostgreSQL callers use this when other params have already
 *                      been bound; SQLite ignores it because placeholders are positional.
 */
export function buildSearchWhere<Entity>(
  dialect: ISqlDialect,
  criteria: DeleteSearchCriteria<Entity>,
  schemaProps: Record<string, unknown>,
  convertValue: (column: string, value: Entity[keyof Entity]) => ValueOptionType,
  startIndex: number = 1
): BuiltWhereClause {
  const conditions: string[] = [];
  const params: ValueOptionType[] = [];
  let paramIndex = startIndex;

  for (const column of Object.keys(criteria) as Array<keyof Entity>) {
    if (!(column in schemaProps)) {
      throw new Error(`Schema must have a ${String(column)} field to use deleteSearch`);
    }

    const criterion = criteria[column];
    let operator: SearchOperator = "=";
    let value: Entity[keyof Entity];

    if (isSearchCondition(criterion)) {
      operator = criterion.operator;
      value = criterion.value as Entity[keyof Entity];
    } else {
      value = criterion as Entity[keyof Entity];
    }

    conditions.push(
      `${dialect.quoteId(String(column))} ${operator} ${dialect.placeholder(paramIndex)}`
    );
    params.push(convertValue(column as string, value));
    paramIndex++;
  }

  return {
    whereClause: conditions.join(" AND "),
    params,
  };
}
