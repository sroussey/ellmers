/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { JoinSpec, ValueOptionType } from "../../tabular/ITabularStorage";
import { DuckDbDialect, PostgresDialect, SqliteDialect } from "../Dialect";
import type { SqlJoinSide } from "../JoinSql";
import { buildJoinSelect, joinColumnAlias } from "../JoinSql";

interface Post {
  readonly id: string;
  readonly author_id: string | null;
  readonly views: number;
}
interface Author {
  readonly id: string;
  readonly name: string;
}

const passthrough = (_column: string, value: unknown): ValueOptionType => value as ValueOptionType;

const posts: SqlJoinSide = {
  table: "posts",
  alias: "l",
  columns: ["id", "author_id", "views"],
  schemaProps: { id: {}, author_id: {}, views: {} },
  convertValue: passthrough,
};
const authors: SqlJoinSide = {
  table: "authors",
  alias: "r",
  columns: ["id", "name"],
  schemaProps: { id: {}, name: {} },
  convertValue: passthrough,
};

const SELECT_PG =
  'SELECT "l"."id" AS "l0", "l"."author_id" AS "l1", "l"."views" AS "l2", ' +
  '"r"."id" AS "r0", "r"."name" AS "r1" FROM "posts" AS "l"';

describe("joinColumnAlias", () => {
  it("keys by side and position, not by column name", () => {
    expect(joinColumnAlias("left", 0)).toBe("l0");
    expect(joinColumnAlias("right", 0)).toBe("r0");
    expect(joinColumnAlias("left", 12)).toBe("l12");
  });

  it("stays well under Postgres's 63-byte identifier limit for any column name", () => {
    // A name-derived alias over a 61-character column produced a 64-byte
    // identifier, which Postgres silently truncates — every hydration lookup
    // against it then missed.
    const longColumn = "a".repeat(61);
    const side: SqlJoinSide = {
      table: "t",
      alias: "l",
      columns: [longColumn, "id"],
      schemaProps: { [longColumn]: {}, id: {} },
      convertValue: passthrough,
    };
    const { sql } = buildJoinSelect(
      PostgresDialect,
      { type: "inner", on: [{ left: "id", right: "id" }] },
      side,
      authors
    );
    for (const alias of sql.matchAll(/ AS "([^"]+)"/g)) {
      expect(alias[1].length).toBeLessThanOrEqual(63);
    }
  });
});

describe("buildJoinSelect", () => {
  it("renders a bare LEFT JOIN with aliased columns", () => {
    const spec: JoinSpec<Post, Author> = { type: "left", on: [{ left: "author_id", right: "id" }] };
    const { sql, params } = buildJoinSelect(PostgresDialect, spec, posts, authors);
    expect(sql).toBe(`${SELECT_PG} LEFT JOIN "authors" AS "r" ON "l"."author_id" = "r"."id"`);
    expect(params).toEqual([]);
  });

  it("renders INNER JOIN for an inner spec", () => {
    const spec: JoinSpec<Post, Author> = {
      type: "inner",
      on: [{ left: "author_id", right: "id" }],
    };
    const { sql } = buildJoinSelect(PostgresDialect, spec, posts, authors);
    expect(sql).toContain(' INNER JOIN "authors" AS "r" ON ');
  });

  it("puts the right-side filter in ON and the left-side filter in WHERE", () => {
    const spec: JoinSpec<Post, Author> = {
      type: "left",
      on: [{ left: "author_id", right: "id" }],
      where: { left: { views: { value: 10, operator: ">" } }, right: { name: "ann" } },
    };
    const { sql, params } = buildJoinSelect(PostgresDialect, spec, posts, authors);
    expect(sql).toBe(
      `${SELECT_PG} LEFT JOIN "authors" AS "r" ON "l"."author_id" = "r"."id" AND ("r"."name" = $1)` +
        ' WHERE "l"."views" > $2'
    );
    expect(params).toEqual(["ann", 10]);
  });

  it("threads $N through ON, WHERE, LIMIT and OFFSET counting an in-list as one parameter", () => {
    const spec: JoinSpec<Post, Author> = {
      type: "inner",
      on: [{ left: "author_id", right: "id" }],
      where: {
        left: { id: { value: ["p1", "p2"], operator: "in" }, views: 3 },
        right: { name: { value: ["a", "b", "c"], operator: "in" } },
      },
      orderBy: [{ side: "right", column: "name", direction: "DESC" }],
      limit: 5,
      offset: 10,
    };
    const { sql, params } = buildJoinSelect(PostgresDialect, spec, posts, authors);
    expect(sql).toBe(
      `${SELECT_PG} INNER JOIN "authors" AS "r" ON "l"."author_id" = "r"."id" AND ("r"."name" = ANY($1))` +
        ' WHERE "l"."id" = ANY($2) AND "l"."views" = $3' +
        ' ORDER BY "r"."name" DESC NULLS LAST LIMIT $4 OFFSET $5'
    );
    expect(params).toEqual([["a", "b", "c"], ["p1", "p2"], 3, 5, 10]);
  });

  it("expands in-lists and keeps $N numbering on DuckDB", () => {
    const spec: JoinSpec<Post, Author> = {
      type: "inner",
      on: [{ left: "author_id", right: "id" }],
      where: { right: { name: { value: ["a", "b"], operator: "in" } } },
      limit: 1,
    };
    const { sql, params } = buildJoinSelect(DuckDbDialect, spec, posts, authors);
    expect(sql).toContain('ON "l"."author_id" = "r"."id" AND ("r"."name" IN ($1, $2)) LIMIT $3');
    expect(params).toEqual(["a", "b", 1]);
  });

  it("uses backticks and positional placeholders on SQLite", () => {
    const spec: JoinSpec<Post, Author> = {
      type: "left",
      on: [{ left: "author_id", right: "id" }],
      where: { left: { views: 1 } },
      orderBy: [{ side: "left", column: "views", direction: "ASC" }],
      limit: 2,
      offset: 4,
    };
    const { sql, params } = buildJoinSelect(SqliteDialect, spec, posts, authors);
    expect(sql).toBe(
      "SELECT `l`.`id` AS `l0`, `l`.`author_id` AS `l1`, `l`.`views` AS `l2`, " +
        "`r`.`id` AS `r0`, `r`.`name` AS `r1` FROM `posts` AS `l`" +
        " LEFT JOIN `authors` AS `r` ON `l`.`author_id` = `r`.`id`" +
        " WHERE `l`.`views` = ? ORDER BY `l`.`views` ASC NULLS FIRST LIMIT ? OFFSET ?"
    );
    expect(params).toEqual([1, 2, 4]);
  });

  it("emits LIMIT -1 before an OFFSET without LIMIT on SQLite only", () => {
    const spec: JoinSpec<Post, Author> = {
      type: "left",
      on: [{ left: "author_id", right: "id" }],
      offset: 3,
    };
    expect(buildJoinSelect(SqliteDialect, spec, posts, authors).sql).toMatch(
      / LIMIT -1 OFFSET \?$/
    );
    expect(buildJoinSelect(PostgresDialect, spec, posts, authors).sql).toMatch(/ OFFSET \$1$/);
  });

  it("ANDs every pair of a compound key", () => {
    const tenantPosts: SqlJoinSide = {
      ...posts,
      columns: ["id", "tenant", "author_id"],
      schemaProps: { id: {}, tenant: {}, author_id: {} },
    };
    const tenantAuthors: SqlJoinSide = {
      ...authors,
      columns: ["id", "tenant"],
      schemaProps: { id: {}, tenant: {} },
    };
    const spec: JoinSpec<any, any> = {
      type: "inner",
      on: [
        { left: "tenant", right: "tenant" },
        { left: "author_id", right: "id" },
      ],
    };
    const { sql } = buildJoinSelect(PostgresDialect, spec, tenantPosts, tenantAuthors);
    expect(sql).toContain('ON "l"."tenant" = "r"."tenant" AND "l"."author_id" = "r"."id"');
  });

  it("runs each side's criteria values through that side's converter", () => {
    const spec: JoinSpec<Post, Author> = {
      type: "inner",
      on: [{ left: "author_id", right: "id" }],
      where: { left: { views: 1 }, right: { name: "x" } },
    };
    const tagged =
      (tag: string): SqlJoinSide["convertValue"] =>
      (column, value) =>
        `${tag}:${column}:${String(value)}`;
    const { params } = buildJoinSelect(
      PostgresDialect,
      spec,
      { ...posts, convertValue: tagged("L") },
      { ...authors, convertValue: tagged("R") }
    );
    expect(params).toEqual(["R:name:x", "L:views:1"]);
  });
});
