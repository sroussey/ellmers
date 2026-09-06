/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";
import { describe, expect, it, vi } from "vitest";
import type { HashJoinDeps } from "../hashJoin";
import { joinInChunkSize, joinKeyFingerprint, runHashJoin, sortJoinedRows } from "../hashJoin";
import { InMemoryTabularStorage } from "../InMemoryTabularStorage";
import type { JoinedRow, JoinSpec } from "../ITabularStorage";

const AuthorSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    tenant: { type: "string" },
    name: { type: "string" },
  },
  required: ["id", "tenant", "name"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
const AuthorPk = ["id"] as const;

const PostSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    tenant: { type: "string" },
    author_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    views: { type: "number" },
  },
  required: ["id", "tenant", "author_id", "views"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
const PostPk = ["id"] as const;

interface Author {
  readonly id: string;
  readonly tenant: string;
  readonly name: string;
}
interface Post {
  readonly id: string;
  readonly tenant: string;
  readonly author_id: string | null;
  readonly views: number;
}

async function fixtures(): Promise<{
  posts: InMemoryTabularStorage<typeof PostSchema, typeof PostPk>;
  authors: InMemoryTabularStorage<typeof AuthorSchema, typeof AuthorPk>;
  deps: HashJoinDeps<Post, Author>;
}> {
  const posts = new InMemoryTabularStorage<typeof PostSchema, typeof PostPk>(PostSchema, PostPk);
  const authors = new InMemoryTabularStorage<typeof AuthorSchema, typeof AuthorPk>(
    AuthorSchema,
    AuthorPk
  );
  await authors.putBulk([
    { id: "a1", tenant: "t1", name: "Ann" },
    { id: "a2", tenant: "t1", name: "Bob" },
    { id: "a3", tenant: "t2", name: "Cid" },
  ]);
  await posts.putBulk([
    { id: "p1", tenant: "t1", author_id: "a1", views: 10 },
    { id: "p2", tenant: "t1", author_id: "a1", views: 5 },
    { id: "p3", tenant: "t1", author_id: "a2", views: 7 },
    { id: "p4", tenant: "t1", author_id: "zz", views: 1 },
    { id: "p5", tenant: "t1", author_id: null, views: 3 },
    { id: "p6", tenant: "t2", author_id: "a1", views: 9 },
  ]);
  const deps: HashJoinDeps<Post, Author> = {
    leftQuery: (c, o) => posts.query(c, o) as Promise<Post[] | undefined>,
    leftGetAll: (o) => posts.getAll(o) as Promise<Post[] | undefined>,
    rightQuery: (c) => authors.query(c) as Promise<Author[] | undefined>,
  };
  return { posts, authors, deps };
}

const ids = (rows: ReadonlyArray<JoinedRow<Post, Author, any>>): string[] =>
  rows.map((r) => `${r.left.id}:${r.right?.id ?? "-"}`);

describe("joinKeyFingerprint", () => {
  it("is undefined when any key component is null or missing", () => {
    expect(joinKeyFingerprint({ a: 1, b: null }, ["a", "b"])).toBeUndefined();
    expect(joinKeyFingerprint({ a: 1 }, ["a", "b"])).toBeUndefined();
  });

  it("distinguishes types and orders", () => {
    expect(joinKeyFingerprint({ a: 1 }, ["a"])).not.toBe(joinKeyFingerprint({ a: "1" }, ["a"]));
    expect(joinKeyFingerprint({ a: 1, b: 2 }, ["a", "b"])).toBe(
      joinKeyFingerprint({ b: 2, a: 1 }, ["a", "b"])
    );
  });
});

describe("sortJoinedRows", () => {
  it("sorts by a right-side column with a missing right side first under ASC and last under DESC", () => {
    const rows: JoinedRow<Post, Author, "left">[] = [
      {
        left: { id: "p1", tenant: "t", author_id: "b", views: 0 },
        right: { id: "b", tenant: "t", name: "Bob" },
      },
      { left: { id: "p2", tenant: "t", author_id: null, views: 0 }, right: undefined },
      {
        left: { id: "p3", tenant: "t", author_id: "a", views: 0 },
        right: { id: "a", tenant: "t", name: "Ann" },
      },
    ];
    sortJoinedRows(rows, [{ side: "right", column: "name", direction: "ASC" }]);
    expect(ids(rows)).toEqual(["p2:-", "p3:a", "p1:b"]);
    sortJoinedRows(rows, [{ side: "right", column: "name", direction: "DESC" }]);
    expect(ids(rows)).toEqual(["p1:b", "p3:a", "p2:-"]);
  });
});

describe("runHashJoin", () => {
  const on = [{ left: "author_id", right: "id" }] as const;

  it("inner join drops unmatched and null-keyed left rows", async () => {
    const { deps } = await fixtures();
    const rows = await runHashJoin(deps, { type: "inner", on });
    expect(ids(rows).sort()).toEqual(["p1:a1", "p2:a1", "p3:a2", "p6:a1"]);
  });

  it("left join keeps unmatched and null-keyed left rows with right undefined", async () => {
    const { deps } = await fixtures();
    const rows = await runHashJoin(deps, { type: "left", on });
    expect(ids(rows).sort()).toEqual(["p1:a1", "p2:a1", "p3:a2", "p4:-", "p5:-", "p6:a1"]);
  });

  it("a right-side filter under a left join keeps unmatched left rows", async () => {
    const { deps } = await fixtures();
    const rows = await runHashJoin(deps, {
      type: "left",
      on,
      where: { right: { name: "Ann" } },
    });
    expect(ids(rows).sort()).toEqual(["p1:a1", "p2:a1", "p3:-", "p4:-", "p5:-", "p6:a1"]);
  });

  it("joins on a compound key and post-filters the cross product", async () => {
    const { deps } = await fixtures();
    // p6 is tenant t2 with author a1 (tenant t1): the per-column in-lists
    // would admit (t2, a1) only through the cross product, and the tuple
    // filter must reject it.
    const rows = await runHashJoin(deps, {
      type: "inner",
      on: [
        { left: "tenant", right: "tenant" },
        { left: "author_id", right: "id" },
      ],
    });
    expect(ids(rows).sort()).toEqual(["p1:a1", "p2:a1", "p3:a2"]);
  });

  it("pushes a left-only orderBy down to the left query and preserves it", async () => {
    const { deps } = await fixtures();
    const leftQuery = vi.fn(deps.leftGetAll);
    const rows = await runHashJoin(
      { ...deps, leftGetAll: leftQuery },
      { type: "left", on, orderBy: [{ side: "left", column: "views", direction: "DESC" }] }
    );
    expect(leftQuery).toHaveBeenCalledWith({
      orderBy: [{ column: "views", direction: "DESC" }],
    });
    expect(rows.map((r) => r.left.views)).toEqual([10, 9, 7, 5, 3, 1]);
  });

  it("sorts in memory on a right-side column, then applies offset and limit", async () => {
    const { deps } = await fixtures();
    const rows = await runHashJoin(deps, {
      type: "left",
      on,
      orderBy: [
        { side: "right", column: "name", direction: "ASC" },
        { side: "left", column: "id", direction: "ASC" },
      ],
      offset: 1,
      limit: 3,
    });
    // Full order: p4:-, p5:- (NULLS FIRST), p1:a1, p2:a1, p6:a1, p3:a2
    expect(ids(rows)).toEqual(["p5:-", "p1:a1", "p2:a1"]);
  });

  it("applies limit to the joined rows, not the left rows", async () => {
    const { deps } = await fixtures();
    const rows = await runHashJoin(deps, {
      type: "inner",
      on,
      orderBy: [{ side: "left", column: "id", direction: "ASC" }],
      limit: 3,
    });
    // p4 and p5 have no author; an inner join must skip them and still fill the limit.
    expect(ids(rows)).toEqual(["p1:a1", "p2:a1", "p3:a2"]);
  });

  it("uses the left filter and the caller's own criterion on the join column", async () => {
    const { deps } = await fixtures();
    const rightQuery = vi.fn(deps.rightQuery);
    const rows = await runHashJoin(
      { ...deps, rightQuery },
      {
        type: "inner",
        on,
        where: { left: { tenant: "t1" }, right: { id: "a1" } },
      }
    );
    expect(ids(rows).sort()).toEqual(["p1:a1", "p2:a1"]);
    // The join column is already constrained by the caller: no in-list is added,
    // and one fetch serves every tuple.
    expect(rightQuery).toHaveBeenCalledTimes(1);
    expect(rightQuery).toHaveBeenCalledWith({ id: "a1" });
  });

  it("chunks the right-side in-list and still matches every row", async () => {
    const posts = new InMemoryTabularStorage<typeof PostSchema, typeof PostPk>(PostSchema, PostPk);
    const authors = new InMemoryTabularStorage<typeof AuthorSchema, typeof AuthorPk>(
      AuthorSchema,
      AuthorPk
    );
    const n = joinInChunkSize(1) * 2 + 1;
    await authors.putBulk(
      Array.from({ length: n }, (_, i) => ({ id: `a${i}`, tenant: "t", name: `n${i}` }))
    );
    await posts.putBulk(
      Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        tenant: "t",
        author_id: `a${i}`,
        views: i,
      }))
    );
    const rightQuery = vi.fn((c: any) => authors.query(c) as Promise<Author[] | undefined>);
    const rows = await runHashJoin<Post, Author, "inner">(
      {
        leftQuery: (c, o) => posts.query(c, o) as Promise<Post[] | undefined>,
        leftGetAll: (o) => posts.getAll(o) as Promise<Post[] | undefined>,
        rightQuery,
      },
      { type: "inner", on }
    );
    expect(rows).toHaveLength(n);
    expect(rightQuery).toHaveBeenCalledTimes(3);
    expect(rows.every((r) => r.right.id === r.left.author_id)).toBe(true);
  });

  it("divides the parameter budget between the columns of a compound key", () => {
    // Each free join column contributes its own `in` list to the same
    // statement, so a flat cap would bind columns x tuples parameters and blow
    // the limit it exists to respect.
    expect(joinInChunkSize(1)).toBe(900);
    expect(joinInChunkSize(2)).toBe(450);
    expect(joinInChunkSize(3)).toBe(300);
    for (const columns of [1, 2, 3, 7]) {
      expect(joinInChunkSize(columns) * columns).toBeLessThanOrEqual(900);
    }
  });

  it("intersects the caller's in-list on a join column instead of dropping the key restriction", async () => {
    const { deps } = await fixtures();
    const rightQuery = vi.fn(deps.rightQuery);
    const rows = await runHashJoin(
      { ...deps, rightQuery },
      {
        type: "inner",
        on,
        // Both this and the left-derived key list constrain `id`; the two are
        // intersected rather than the caller's simply winning.
        where: { right: { id: { value: ["a1", "a3"], operator: "in" } } },
      }
    );
    expect(ids(rows).sort()).toEqual(["p1:a1", "p2:a1", "p6:a1"]);
    const criteria = rightQuery.mock.calls[0][0] as { id: { value: readonly string[] } };
    // a3 is in the caller's list but no left row references it; a2 is
    // referenced but excluded by the caller. Neither should be fetched.
    expect([...criteria.id.value].sort()).toEqual(["a1"]);
  });

  it("does not push an orderBy down when the ordered column can be null", async () => {
    const { deps } = await fixtures();
    const leftGetAll = vi.fn(deps.leftGetAll);
    await runHashJoin(
      { ...deps, leftGetAll, leftColumnIsNullable: (c) => c === "author_id" },
      { type: "left", on, orderBy: [{ side: "left", column: "author_id", direction: "ASC" }] }
    );
    // Pushed down, the backend's own NULL placement would apply and disagree
    // with this module's; so the order stays in memory.
    expect(leftGetAll).toHaveBeenCalledWith(undefined);
  });

  it("bounds the left read for a left join with a pushed-down order and a limit", async () => {
    const { deps } = await fixtures();
    const leftGetAll = vi.fn(deps.leftGetAll);
    const rows = await runHashJoin(
      { ...deps, leftGetAll },
      {
        type: "left",
        on,
        orderBy: [{ side: "left", column: "views", direction: "DESC" }],
        offset: 1,
        limit: 2,
      }
    );
    expect(leftGetAll).toHaveBeenCalledWith({
      orderBy: [{ column: "views", direction: "DESC" }],
      limit: 3,
    });
    expect(ids(rows)).toEqual(["p6:a1", "p3:a2"]);
  });

  it("bounds the left read for an inner join whose first prefix already fills the limit", async () => {
    const { deps } = await fixtures();
    const leftGetAll = vi.fn(deps.leftGetAll);
    const rows = await runHashJoin(
      { ...deps, leftGetAll },
      {
        type: "inner",
        on,
        orderBy: [{ side: "left", column: "views", direction: "DESC" }],
        limit: 3,
      }
    );
    // p1, p6 and p3 are the three highest-viewed posts and all three match, so
    // three left rows are all this join ever has to read.
    expect(leftGetAll.mock.calls).toEqual([
      [{ orderBy: [{ column: "views", direction: "DESC" }], limit: 3 }],
    ]);
    expect(ids(rows)).toEqual(["p1:a1", "p6:a1", "p3:a2"]);
  });

  it("widens the left read for an inner join until the limit is filled", async () => {
    const { deps } = await fixtures();
    const leftGetAll = vi.fn(deps.leftGetAll);
    const rows = await runHashJoin(
      { ...deps, leftGetAll },
      {
        type: "inner",
        on,
        // Ascending by views puts the two unmatched posts (p4 views 1 with a
        // dangling author, p5 views 3 with a null key) first, so a read bounded
        // at the limit yields only one joined row and has to widen.
        orderBy: [{ side: "left", column: "views", direction: "ASC" }],
        limit: 3,
      }
    );
    expect(leftGetAll.mock.calls).toEqual([
      [{ orderBy: [{ column: "views", direction: "ASC" }], limit: 3 }],
      [{ orderBy: [{ column: "views", direction: "ASC" }], limit: 12 }],
    ]);
    expect(ids(rows)).toEqual(["p2:a1", "p3:a2", "p6:a1"]);
  });

  it("reads the whole left side when the order can only be applied in memory", async () => {
    const { deps } = await fixtures();
    const leftGetAll = vi.fn(deps.leftGetAll);
    const rows = await runHashJoin(
      { ...deps, leftGetAll },
      {
        type: "inner",
        on,
        // A right-side order is decided after the pairing, so no prefix of the
        // left side can be known to hold the first `limit` rows.
        orderBy: [{ side: "right", column: "name", direction: "ASC" }],
        limit: 2,
      }
    );
    expect(leftGetAll.mock.calls).toEqual([[undefined]]);
    expect(rows).toHaveLength(2);
  });

  it("bounds an unordered join, whose result order is unspecified either way", async () => {
    const { deps } = await fixtures();
    const leftGetAll = vi.fn(deps.leftGetAll);
    const rows = await runHashJoin({ ...deps, leftGetAll }, { type: "left", on, limit: 2 });
    expect(leftGetAll.mock.calls).toEqual([[{ limit: 2 }]]);
    expect(rows).toHaveLength(2);
  });

  it("emits one row per matching right row when the right side is one-to-many", async () => {
    const { deps, authors } = await fixtures();
    // Two authors share a tenant, so joining on `tenant` alone makes the right
    // side one-to-many: every left row fans out across its matches.
    const rows = await runHashJoin(deps, {
      type: "inner",
      on: [{ left: "tenant", right: "tenant" }],
      where: { left: { id: "p1" } },
      orderBy: [{ side: "right", column: "id", direction: "ASC" }],
    });
    expect(ids(rows)).toEqual(["p1:a1", "p1:a2"]);
    // The same left row is reported once per match, not collapsed to one.
    expect(rows.map((r) => r.left.id)).toEqual(["p1", "p1"]);
    void authors;
  });

  it("falls back to the whole budget when no column needs an in-list", () => {
    expect(joinInChunkSize(0)).toBe(900);
    expect(joinInChunkSize(-1)).toBe(900);
  });

  it("reports an unorderable column as a join error, not a pagination-cursor one", async () => {
    const { deps } = await fixtures();
    // `compareKeyValues` is the cursor comparator and refuses bigint and
    // non-primitives in cursor vocabulary; a join never paginated, so the
    // error has to name the column and the join instead.
    const bigintDeps = {
      ...deps,
      rightQuery: async () =>
        [
          { id: "a1", tenant: "t1", name: 10n as unknown as string, country: null },
        ] as unknown as Author[],
    };
    await expect(
      runHashJoin(bigintDeps, {
        type: "inner",
        on,
        orderBy: [{ side: "right", column: "name", direction: "ASC" }],
      })
    ).rejects.toThrow(/Cannot order a join by right column "name"/);
  });

  it("never matches a right row whose own join key is null", async () => {
    const { deps } = await fixtures();
    // The left-side rule is covered above (p5 has a null author_id); this is
    // its mirror. A right row with a null key must not pair with anything —
    // SQL never matches on NULL — even though the left rows here do have keys.
    const nullKeyedRight = {
      ...deps,
      rightQuery: async () =>
        [
          { id: null, tenant: "t1", name: "No id", country: null },
          { id: "a1", tenant: "t1", name: "Ann", country: "US" },
        ] as unknown as Author[],
    };
    const rows = await runHashJoin(nullKeyedRight, { type: "left", on });
    // Only the real a1 pairs; the null-keyed row matches no left row at all.
    expect(ids(rows).sort()).toEqual(["p1:a1", "p2:a1", "p3:-", "p4:-", "p5:-", "p6:a1"]);
  });

  it("returns [] for an inner join with no left rows", async () => {
    const { deps, posts } = await fixtures();
    await posts.deleteAll();
    expect(await runHashJoin(deps, { type: "inner", on })).toEqual([]);
  });

  it("does not query the right side when no left row has a key", async () => {
    const { deps, posts } = await fixtures();
    await posts.deleteAll();
    await posts.put({ id: "p9", tenant: "t1", author_id: null, views: 0 });
    const rightQuery = vi.fn(deps.rightQuery);
    const rows = await runHashJoin({ ...deps, rightQuery }, { type: "left", on });
    expect(ids(rows)).toEqual(["p9:-"]);
    expect(rightQuery).not.toHaveBeenCalled();
  });

  it("infers the right type from the spec", async () => {
    const { deps } = await fixtures();
    const spec: JoinSpec<Post, Author, "inner"> = { type: "inner", on };
    const rows = await runHashJoin(deps, spec);
    // `right` is `Author`, not `Author | undefined`, under an inner join.
    const names: string[] = rows.map((r) => r.right.name);
    expect(names.length).toBeGreaterThan(0);
  });
});
