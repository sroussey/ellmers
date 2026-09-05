/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JoinSide, JoinSpec, ValueOptionType } from "../tabular/ITabularStorage";
import type { ISqlDialect } from "./Dialect";
import { buildSearchWhere } from "./PredicateBuilder";

export const JOIN_LEFT_ALIAS = "l";
export const JOIN_RIGHT_ALIAS = "r";

/**
 * The output column name a joined SELECT gives `column` of `side`. Both
 * tables' columns land in one flat result row, so each is prefixed with its
 * side to keep same-named columns apart.
 */
export function joinColumnAlias(side: JoinSide, column: string): string {
  return `${side === "left" ? JOIN_LEFT_ALIAS : JOIN_RIGHT_ALIAS}__${column}`;
}

/** What {@link buildJoinSelect} needs to know about one side of the join. */
export interface SqlJoinSide {
  readonly table: string;
  readonly alias: string;
  /** Every schema column, primary key first, in declaration order. */
  readonly columns: readonly string[];
  readonly schemaProps: Record<string, unknown>;
  /** The side's own JS-to-SQL coercion, applied to its criteria values. */
  readonly convertValue: (column: string, value: unknown) => ValueOptionType;
}

export interface BuiltJoinSelect {
  readonly sql: string;
  readonly params: ValueOptionType[];
}

/**
 * Renders a two-table join as one parameterized SELECT. Parameters are bound
 * in textual order — join condition, then WHERE, then LIMIT/OFFSET — and the
 * placeholder index advances by the number each fragment actually bound, since
 * a Postgres `in` list is one array parameter.
 *
 * The right-side filter goes into the `ON` clause on purpose: in `WHERE` it
 * would discard the NULL-extended rows of a LEFT JOIN and quietly turn it into
 * an inner join.
 */
export function buildJoinSelect(
  dialect: ISqlDialect,
  spec: JoinSpec<any, any>,
  left: SqlJoinSide,
  right: SqlJoinSide
): BuiltJoinSelect {
  const q = (id: string): string => dialect.quoteId(id);
  const lq = q(left.alias);
  const rq = q(right.alias);
  const params: ValueOptionType[] = [];
  let index = 1;

  const selectList = [
    ...left.columns.map((c) => `${lq}.${q(c)} AS ${q(joinColumnAlias("left", c))}`),
    ...right.columns.map((c) => `${rq}.${q(c)} AS ${q(joinColumnAlias("right", c))}`),
  ].join(", ");

  const onParts = spec.on.map((o) => `${lq}.${q(String(o.left))} = ${rq}.${q(String(o.right))}`);
  const rightWhere = spec.where?.right;
  if (rightWhere !== undefined && Object.keys(rightWhere).length > 0) {
    const built = buildSearchWhere<any>(
      dialect,
      rightWhere,
      right.schemaProps,
      right.convertValue,
      index,
      right.alias
    );
    onParts.push(`(${built.whereClause})`);
    params.push(...built.params);
    index += built.params.length;
  }

  const joinKeyword = spec.type === "left" ? "LEFT JOIN" : "INNER JOIN";
  let sql =
    `SELECT ${selectList} FROM ${q(left.table)} AS ${lq}` +
    ` ${joinKeyword} ${q(right.table)} AS ${rq} ON ${onParts.join(" AND ")}`;

  const leftWhere = spec.where?.left;
  if (leftWhere !== undefined && Object.keys(leftWhere).length > 0) {
    const built = buildSearchWhere<any>(
      dialect,
      leftWhere,
      left.schemaProps,
      left.convertValue,
      index,
      left.alias
    );
    sql += ` WHERE ${built.whereClause}`;
    params.push(...built.params);
    index += built.params.length;
  }

  if (spec.orderBy !== undefined && spec.orderBy.length > 0) {
    // Same NULL placement the single-table page path uses: SQLite and
    // Postgres disagree by default, and the in-memory join sorts this way too.
    const orderClauses = spec.orderBy.map((o) => {
      const alias = o.side === "left" ? lq : rq;
      const nulls = o.direction === "ASC" ? "NULLS FIRST" : "NULLS LAST";
      return `${alias}.${q(o.column)} ${o.direction} ${nulls}`;
    });
    sql += ` ORDER BY ${orderClauses.join(", ")}`;
  }

  if (spec.limit !== undefined) {
    sql += ` LIMIT ${dialect.placeholder(index)}`;
    params.push(spec.limit);
    index++;
  }
  if (spec.offset !== undefined) {
    // SQLite has no OFFSET without LIMIT; -1 means unbounded.
    if (spec.limit === undefined && dialect.name === "sqlite") {
      sql += ` LIMIT -1`;
    }
    sql += ` OFFSET ${dialect.placeholder(index)}`;
    params.push(spec.offset);
    index++;
  }

  return { sql, params };
}
