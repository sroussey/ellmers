/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import {
  ScopedTabularStorage,
  SharedDocumentIndexes,
  SharedDocumentPrimaryKey,
  SharedDocumentStorageSchema,
} from "@workglow/knowledge-base";
import { PostgresTabularStorage } from "@workglow/postgres/storage";
import { uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const db = new PGlite() as unknown as Pool;

// Postgres maps `doc_id: { type: "string", "x-auto-generated": true }` to a
// UUID column with `DEFAULT gen_random_uuid()`. To exercise key-collision
// behaviour across scopes deterministically, we use real UUIDs for the
// colliding keys rather than the natural-language "x"/"y"/"z" that the
// in-memory test uses.
const COLLIDE_X = uuid4();
const COLLIDE_Y = uuid4();
const COLLIDE_Z = uuid4();
const COLLIDE_MISSING = uuid4();

describe("ScopedTabularStorage over PostgresTabularStorage", () => {
  let sharedStorage: PostgresTabularStorage<
    typeof SharedDocumentStorageSchema,
    typeof SharedDocumentPrimaryKey
  >;
  let scopeA: ScopedTabularStorage<any, any>;
  let scopeB: ScopedTabularStorage<any, any>;

  beforeAll(async () => {
    sharedStorage = new PostgresTabularStorage<
      typeof SharedDocumentStorageSchema,
      typeof SharedDocumentPrimaryKey
    >(
      db,
      `scoped_test_${uuid4().replace(/-/g, "_")}`,
      SharedDocumentStorageSchema,
      SharedDocumentPrimaryKey,
      SharedDocumentIndexes as any
    );
    await sharedStorage.setupDatabase();
    scopeA = new ScopedTabularStorage(sharedStorage as any, "kb-a");
    scopeB = new ScopedTabularStorage(sharedStorage as any, "kb-b");
  });

  afterAll(async () => {
    await (db as unknown as PGlite).close();
  });

  describe("getBulk cross-KB isolation", () => {
    test("getBulk returns only own scope's rows when keys collide across scopes", async () => {
      await scopeA.put({ doc_id: COLLIDE_X, data: "from-A" });
      await scopeA.put({ doc_id: COLLIDE_Y, data: "from-A" });
      await scopeB.put({ doc_id: COLLIDE_X, data: "from-B" });
      await scopeB.put({ doc_id: COLLIDE_Z, data: "from-B" });

      // The SQL-backend code path: `PostgresTabularStorage.getBulk` builds an
      // IN-tuple WHERE from the declared primary-key columns only. If the
      // inner PK doesn't include `kb_id`, the wrapper's injected scope key
      // gets dropped from the predicate — KB-A would see KB-B's rows for
      // the colliding key COLLIDE_X. The fix is enforced at the
      // `ScopedTabularStorage` constructor: it requires `kb_id` to appear in
      // the inner PK so the existing one-round-trip `inner.getBulk(scopedKeys)`
      // IN-tuple WHERE naturally carries the scope. This test exercises that
      // contract on a real SQL backend.
      const fromA = await scopeA.getBulk([
        { doc_id: COLLIDE_X },
        { doc_id: COLLIDE_Y },
        { doc_id: COLLIDE_Z },
      ] as any);
      expect(fromA).toHaveLength(2);
      const aMap = new Map(fromA.map((r: any) => [r.doc_id, r.data]));
      expect(aMap.get(COLLIDE_X)).toBe("from-A");
      expect(aMap.get(COLLIDE_Y)).toBe("from-A");
      expect(aMap.has(COLLIDE_Z)).toBe(false);
      expect(fromA.every((r: any) => r.kb_id === undefined)).toBe(true);

      const fromB = await scopeB.getBulk([{ doc_id: COLLIDE_X }, { doc_id: COLLIDE_Z }] as any);
      expect(fromB).toHaveLength(2);
      const bMap = new Map(fromB.map((r: any) => [r.doc_id, r.data]));
      expect(bMap.get(COLLIDE_X)).toBe("from-B");
      expect(bMap.get(COLLIDE_Z)).toBe("from-B");
    });

    test("getBulk emits event with unscoped (kb_id-stripped) entities", async () => {
      const fn = vi.fn();
      scopeA.on("getBulk", fn);
      try {
        const result = await scopeA.getBulk([
          { doc_id: COLLIDE_X },
          { doc_id: COLLIDE_MISSING },
        ] as any);

        expect(fn).toHaveBeenCalledTimes(1);
        const [emittedKeys, emittedRows] = fn.mock.calls[0];
        expect(emittedKeys).toEqual([{ doc_id: COLLIDE_X }, { doc_id: COLLIDE_MISSING }]);
        expect(emittedRows).toEqual(result);
        expect(emittedRows.every((r: any) => r.kb_id === undefined)).toBe(true);
      } finally {
        scopeA.off("getBulk", fn);
      }
    });
  });
});
