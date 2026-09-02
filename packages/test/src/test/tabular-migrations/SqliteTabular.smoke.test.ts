/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite, SqliteTabularStorage } from "@workglow/sqlite/storage";
import type { ITabularMigration } from "@workglow/storage";
import { beforeAll, describe, expect, it } from "vitest";

describe("SqliteTabular migration smoke", () => {
  beforeAll(async () => {
    await Sqlite.init();
  });

  it("applies an addColumn migration to an existing table", async () => {
    const db = new Sqlite.Database(":memory:");
    // Create a "deployed" v0 table with only `id` and `name`.
    const v0 = new SqliteTabularStorage(
      db,
      "users",
      {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const
    );
    await v0.setupDatabase();
    await v0.put({ id: "u1", name: "alice" });

    // Re-open with the "current" target schema (adds `archived`) + a v1
    // migration that adds the column. Because the table already exists,
    // the orchestrator must run the migration.
    const migrations: ITabularMigration[] = [
      {
        version: 1,
        description: "add archived",
        // Use a nullable schema so SQLite can ADD COLUMN to a populated table
        // without a DEFAULT — existing rows get NULL for the new column.
        ops: [
          {
            kind: "addColumn",
            name: "archived",
            schema: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          },
        ],
      },
    ];
    const v1 = new SqliteTabularStorage(
      db,
      "users",
      {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          archived: { type: "boolean" },
        },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const,
      [],
      "if-missing",
      migrations
    );
    await v1.setupDatabase();

    // Column should now exist; the existing row carries NULL for archived.
    const row = (await v1.get({ id: "u1" })) as
      | { id: string; name: string; archived?: boolean | null }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.id).toBe("u1");
    // SQLite returns null for newly added columns on existing rows
    expect(row!.archived ?? null).toBeNull();

    // Bookkeeping should record the migration.
    const applied = db
      .prepare("SELECT version FROM _storage_migrations WHERE component = ?")
      .all("tabular:users") as Array<{ version: number }>;
    expect(applied.map((r) => r.version)).toEqual([1]);
  });
});
