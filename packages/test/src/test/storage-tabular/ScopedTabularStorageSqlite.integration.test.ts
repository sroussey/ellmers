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

describe("ScopedTabularStorage over SqliteTabularStorage", async () => {
  await Sqlite.init();

  let sharedStorage: SqliteTabularStorage<
    typeof SharedDocumentStorageSchema,
    typeof SharedDocumentPrimaryKey
  >;
  let scopeA: ScopedTabularStorage<any, any>;
  let scopeB: ScopedTabularStorage<any, any>;

  beforeAll(async () => {
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
      // IN-tuple WHERE from the declared primary-key columns only. If
      // ScopedTabularStorage.getBulk delegates to it, our injected `kb_id`
      // is dropped — KB-A would see KB-B's rows for the colliding key "x".
      // The fix fans out per-key `get()` calls so the WHERE keeps `kb_id`.
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
        const result = await scopeA.getBulk([
          { doc_id: "x" },
          { doc_id: "missing" },
        ] as any);

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
});
