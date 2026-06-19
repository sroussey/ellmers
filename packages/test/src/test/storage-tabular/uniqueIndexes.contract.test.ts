/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresTabularStorage } from "@workglow/postgres/storage";
import { Sqlite, SqliteTabularStorage } from "@workglow/sqlite/storage";
import { InMemoryTabularStorage, StorageError } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import type { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Contract for the `uniqueIndexes` constructor parameter wired through
 * BaseTabularStorage. Each backend must reject duplicate inserts whose values
 * collide on a declared unique tuple, even when the primary key differs.
 *
 * Notes on the per-backend implementation that this contract pins:
 *   - InMemoryTabularStorage scans the live row Map and throws StorageError
 *     before mutating state.
 *   - SqliteTabularStorage emits `CREATE UNIQUE INDEX IF NOT EXISTS`; the
 *     SQLite driver throws on collision.
 *   - PostgresTabularStorage emits the same DDL via PGlite.
 *
 * NULL semantics follow SQL's "NULL never collides with NULL" rule across
 * all backends — only complete tuples participate in the constraint.
 */

// Two non-PK columns we want to enforce a UNIQUE constraint on.
const PersonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    org_id: { type: "string" },
    name: { type: "string" },
  },
  required: ["id", "email", "org_id", "name"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const PersonPK = ["id"] as const;

type PersonEntity = {
  id: string;
  email: string;
  org_id: string;
  name: string;
};

interface UniqueIndexBackend {
  readonly name: string;
  // The contract operates on shape (put/query/getAll), not the precise generic
  // type of any one backend, so the helper takes a permissive `any` storage
  // reference rather than over-constraining to one class.
  readonly create: (tableSuffix: string) => Promise<any>;
}

function runContract(backend: UniqueIndexBackend): void {
  describe(`${backend.name} — uniqueIndexes`, () => {
    it("rejects a duplicate single-column unique value across different PKs", async () => {
      const storage = (await backend.create("single")) as any;

      await storage.put({
        id: "p1",
        email: "alice@example.com",
        org_id: "orgA",
        name: "Alice",
      } as PersonEntity);

      // Different PK, same email → must throw.
      await expect(
        storage.put({
          id: "p2",
          email: "alice@example.com",
          org_id: "orgB",
          name: "Alice 2",
        } as PersonEntity)
      ).rejects.toThrow();

      // The first row is still there; the failed insert did not land.
      const rowsAfter = await storage.query({ email: "alice@example.com" });
      expect(rowsAfter).toBeDefined();
      expect(rowsAfter.length).toBe(1);
      expect(rowsAfter[0].id).toBe("p1");
    });

    it("allows re-inserting the same PK (UPSERT) without UNIQUE collision", async () => {
      const storage = (await backend.create("upsert")) as any;

      await storage.put({
        id: "p1",
        email: "alice@example.com",
        org_id: "orgA",
        name: "Alice",
      } as PersonEntity);

      // Same PK, same email → the existing row updates in place, no collision.
      await storage.put({
        id: "p1",
        email: "alice@example.com",
        org_id: "orgA",
        name: "Alice (renamed)",
      } as PersonEntity);

      const rows = await storage.query({ id: "p1" });
      expect(rows).toBeDefined();
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("Alice (renamed)");
    });

    it("rejects a duplicate compound unique tuple across different PKs", async () => {
      const storage = (await backend.create("compound")) as any;

      await storage.put({
        id: "p1",
        email: "alice@example.com",
        org_id: "orgA",
        name: "Alice",
      } as PersonEntity);

      // Same (org_id, name), different PK and email → must throw.
      await expect(
        storage.put({
          id: "p2",
          email: "alice2@example.com",
          org_id: "orgA",
          name: "Alice",
        } as PersonEntity)
      ).rejects.toThrow();

      // Differing on either compound column is fine.
      await storage.put({
        id: "p3",
        email: "alice3@example.com",
        org_id: "orgB",
        name: "Alice",
      } as PersonEntity);
      await storage.put({
        id: "p4",
        email: "alice4@example.com",
        org_id: "orgA",
        name: "Bob",
      } as PersonEntity);

      const all = (await storage.getAll())!;
      expect(all.length).toBe(3);
    });
  });
}

// In-memory backend — exercises the JS-side scan path.
runContract({
  name: "InMemoryTabularStorage",
  create: async () =>
    new InMemoryTabularStorage<typeof PersonSchema, typeof PersonPK>(
      PersonSchema,
      PersonPK,
      [],
      "if-missing",
      undefined,
      "inmemory",
      // single-column on email + compound on (org_id, name)
      [["email"], ["org_id", "name"]]
    ),
});

// In-memory backend — surface the exact error type for the upstream check.
describe("InMemoryTabularStorage — uniqueIndexes error type", () => {
  it("rejects duplicates with a StorageError instance", async () => {
    const storage = new InMemoryTabularStorage<typeof PersonSchema, typeof PersonPK>(
      PersonSchema,
      PersonPK,
      [],
      "if-missing",
      undefined,
      "inmemory",
      [["email"]]
    );

    await storage.put({
      id: "p1",
      email: "alice@example.com",
      org_id: "orgA",
      name: "Alice",
    } as PersonEntity);

    let caught: unknown;
    try {
      await storage.put({
        id: "p2",
        email: "alice@example.com",
        org_id: "orgB",
        name: "Alice 2",
      } as PersonEntity);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StorageError);
    expect(String((caught as Error).message)).toMatch(/UNIQUE/);
  });
});

// SQLite backend — exercises the `CREATE UNIQUE INDEX` DDL path.
describe("SqliteTabularStorage — uniqueIndexes", async () => {
  await Sqlite.init();
  runContract({
    name: "SqliteTabularStorage",
    create: async (suffix) => {
      const storage = new SqliteTabularStorage<typeof PersonSchema, typeof PersonPK>(
        ":memory:",
        `unique_${suffix}_${uuid4().replace(/-/g, "_")}`,
        PersonSchema,
        PersonPK,
        [],
        "if-missing",
        undefined,
        [["email"], ["org_id", "name"]]
      );
      await storage.setupDatabase();
      return storage;
    },
  });
});

// Postgres (PGlite) backend — exercises the parallel Postgres DDL path.
const pgliteDb = new PGlite() as unknown as Pool;
afterAll(async () => {
  await (pgliteDb as unknown as PGlite).close();
});

runContract({
  name: "PostgresTabularStorage",
  create: async (suffix) => {
    const storage = new PostgresTabularStorage<typeof PersonSchema, typeof PersonPK>(
      pgliteDb,
      `unique_${suffix}_${uuid4().replace(/-/g, "_")}`,
      PersonSchema,
      PersonPK,
      [],
      "if-missing",
      undefined,
      [["email"], ["org_id", "name"]]
    );
    await storage.setupDatabase();
    return storage as unknown as InstanceType<typeof InMemoryTabularStorage>;
  },
});

// Tuple-overlap dedup happens in BaseTabularStorage so a single InMemory
// subclass that exposes `this.indexes` is enough to pin the behavior across
// every concrete backend.
describe("BaseTabularStorage — indexes / uniqueIndexes overlap dedup", () => {
  class IndexProbe extends InMemoryTabularStorage<typeof PersonSchema, typeof PersonPK> {
    getEffectiveIndexes(): ReadonlyArray<ReadonlyArray<string>> {
      return (this as unknown as { indexes: ReadonlyArray<ReadonlyArray<string>> }).indexes;
    }
  }

  it("drops a regular index whose tuple exactly matches a unique index", () => {
    const probe = new IndexProbe(
      PersonSchema,
      PersonPK,
      [["email"]],
      "if-missing",
      undefined,
      "inmemory",
      [["email"]]
    );
    expect(probe.getEffectiveIndexes()).toEqual([]);
  });

  it("drops a compound regular index that exactly matches a compound unique index", () => {
    const probe = new IndexProbe(
      PersonSchema,
      PersonPK,
      [["org_id", "name"]],
      "if-missing",
      undefined,
      "inmemory",
      [["org_id", "name"]]
    );
    expect(probe.getEffectiveIndexes()).toEqual([]);
  });

  it("keeps a regular index whose columns differ in order from the unique tuple", () => {
    // Index ordering matters for B-tree leftmost-prefix scans, so (name, org_id)
    // is genuinely different from (org_id, name) and should NOT be deduped.
    const probe = new IndexProbe(
      PersonSchema,
      PersonPK,
      [["name", "org_id"]],
      "if-missing",
      undefined,
      "inmemory",
      [["org_id", "name"]]
    );
    expect(probe.getEffectiveIndexes()).toEqual([["name", "org_id"]]);
  });

  it("keeps a single-column regular index that is a prefix (but not a match) of a unique tuple", () => {
    // The existing single-column carve-out in filterCompoundKeys preserves
    // dedicated narrow indexes; the unique (org_id, name) leftmost-prefix
    // scan walks wider rows than a dedicated (org_id) index.
    const probe = new IndexProbe(
      PersonSchema,
      PersonPK,
      [["org_id"]],
      "if-missing",
      undefined,
      "inmemory",
      [["org_id", "name"]]
    );
    expect(probe.getEffectiveIndexes()).toEqual([["org_id"]]);
  });

  it("preserves an unrelated regular index when a different unique tuple is declared", () => {
    const probe = new IndexProbe(
      PersonSchema,
      PersonPK,
      [["name"]],
      "if-missing",
      undefined,
      "inmemory",
      [["email"]]
    );
    expect(probe.getEffectiveIndexes()).toEqual([["name"]]);
  });
});
