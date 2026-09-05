/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ScopedTabularStorage,
  SharedDocumentIndexes,
  SharedDocumentPrimaryKey,
  SharedDocumentStorageSchema,
} from "@workglow/knowledge-base";
import { Sqlite, SqliteTabularStorage } from "@workglow/sqlite/storage";
import { uuid4 } from "@workglow/util";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

describe("ScopedTabularStorage over SqliteTabularStorage", () => {
  let sharedStorage: SqliteTabularStorage<
    typeof SharedDocumentStorageSchema,
    typeof SharedDocumentPrimaryKey
  >;
  let scopeA: ScopedTabularStorage<any, any>;
  let scopeB: ScopedTabularStorage<any, any>;

  beforeAll(async () => {
    // Vitest's `describe` callback doesn't `await` an async function, so any
    // top-level `await Sqlite.init()` there could race with test bodies.
    // Initialise here instead.
    await Sqlite.init();
    sharedStorage = new SqliteTabularStorage<
      typeof SharedDocumentStorageSchema,
      typeof SharedDocumentPrimaryKey
    >(
      ":memory:",
      `scoped_test_${uuid4().replace(/-/g, "_")}`,
      SharedDocumentStorageSchema,
      SharedDocumentPrimaryKey,
      SharedDocumentIndexes as any
    );
    await sharedStorage.setupDatabase();
    scopeA = new ScopedTabularStorage(sharedStorage as any, "kb-a");
    scopeB = new ScopedTabularStorage(sharedStorage as any, "kb-b");
  });

  afterAll(() => {
    sharedStorage?.destroy?.();
  });

  describe("getBulk cross-KB isolation", () => {
    test("getBulk returns only own scope's rows when keys collide across scopes", async () => {
      await scopeA.put({ doc_id: "x", data: "from-A" });
      await scopeA.put({ doc_id: "y", data: "from-A" });
      await scopeB.put({ doc_id: "x", data: "from-B" });
      await scopeB.put({ doc_id: "z", data: "from-B" });

      // The SQL-backend code path: `SqliteTabularStorage.getBulk` builds an
      // IN-tuple WHERE from the declared primary-key columns only. If the
      // inner PK doesn't include `kb_id`, the wrapper's injected scope key
      // gets dropped from the predicate — KB-A would see KB-B's rows for
      // the colliding key "x". The fix is enforced at the `ScopedTabularStorage`
      // constructor: it requires `kb_id` to appear in the inner PK so the
      // existing one-round-trip `inner.getBulk(scopedKeys)` IN-tuple WHERE
      // naturally carries the scope. This test exercises that contract on a
      // real SQL backend.
      const fromA = await scopeA.getBulk([
        { doc_id: "x" },
        { doc_id: "y" },
        { doc_id: "z" },
      ] as any);
      expect(fromA).toHaveLength(2);
      const aMap = new Map(fromA.map((r: any) => [r.doc_id, r.data]));
      expect(aMap.get("x")).toBe("from-A");
      expect(aMap.get("y")).toBe("from-A");
      expect(aMap.has("z")).toBe(false);
      expect(fromA.every((r: any) => r.kb_id === undefined)).toBe(true);

      const fromB = await scopeB.getBulk([{ doc_id: "x" }, { doc_id: "z" }] as any);
      expect(fromB).toHaveLength(2);
      const bMap = new Map(fromB.map((r: any) => [r.doc_id, r.data]));
      expect(bMap.get("x")).toBe("from-B");
      expect(bMap.get("z")).toBe("from-B");
    });

    test("getBulk emits event with unscoped (kb_id-stripped) entities", async () => {
      const fn = vi.fn();
      scopeA.on("getBulk", fn);
      try {
        const result = await scopeA.getBulk([{ doc_id: "x" }, { doc_id: "missing" }] as any);

        expect(fn).toHaveBeenCalledTimes(1);
        const [emittedKeys, emittedRows] = fn.mock.calls[0];
        expect(emittedKeys).toEqual([{ doc_id: "x" }, { doc_id: "missing" }]);
        expect(emittedRows).toEqual(result);
        expect(emittedRows.every((r: any) => r.kb_id === undefined)).toBe(true);
      } finally {
        scopeA.off("getBulk", fn);
      }
    });
  });

  describe("join", () => {
    test("scopes each side to its own kb and runs a same-table join as one statement", async () => {
      await scopeA.put({ doc_id: "j1", data: "A-j1" });
      await scopeA.put({ doc_id: "j2", data: "A-j2" });
      await scopeB.put({ doc_id: "j1", data: "B-j1" });
      const innerQuery = vi.spyOn(sharedStorage, "query");
      const on = [{ left: "doc_id", right: "doc_id" }] as const;
      const where = { left: { doc_id: { value: ["j1", "j2"], operator: "in" as const } } };
      const orderBy = [{ side: "left" as const, column: "doc_id", direction: "ASC" as const }];

      try {
        // Same scope on both sides: kb-b's "j1" must not pair with kb-a's.
        const same = await scopeA.join({ type: "inner", on, where, orderBy }, scopeA);
        expect(same.map((r: any) => `${r.left.data}|${r.right.data}`)).toEqual([
          "A-j1|A-j1",
          "A-j2|A-j2",
        ]);
        expect(
          same.every((r: any) => r.left.kb_id === undefined && r.right.kb_id === undefined)
        ).toBe(true);

        // Different scopes: the right side is scoped to ITS kb, and a LEFT
        // JOIN keeps the kb-a row kb-b has no counterpart for.
        const cross = await scopeA.join({ type: "left", on, where, orderBy }, scopeB);
        expect(cross.map((r: any) => `${r.left.data}|${r.right?.data ?? "-"}`)).toEqual([
          "A-j1|B-j1",
          "A-j2|-",
        ]);

        // Both inner storages are the one SQLite table, so neither join
        // needed the hash path's right-side query.
        expect(innerQuery).not.toHaveBeenCalled();
      } finally {
        innerQuery.mockRestore();
      }
    });

    test("refuses an unscoped right side rather than joining across every kb", async () => {
      await scopeA.put({ doc_id: "leak", data: "A-leak" });
      await scopeB.put({ doc_id: "leak", data: "B-leak" });

      // The shared table is the inner storage both scopes wrap, and the KB
      // layer holds it right next to them. Joining against it directly would
      // put no kb_id filter on the right side, so kb-a's "leak" would pair
      // with kb-b's and come back carrying kb_id.
      await expect(
        scopeA.join(
          { type: "inner", on: [{ left: "doc_id", right: "doc_id" }] },
          sharedStorage as any
        )
      ).rejects.toThrow(/requires a scoped right side/);
    });
  });
});
