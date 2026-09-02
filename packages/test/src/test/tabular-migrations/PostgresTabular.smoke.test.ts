/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresTabularStorage } from "@workglow/postgres/storage";
import type { ITabularMigration } from "@workglow/storage";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

describe("PostgresTabular migration smoke", () => {
  it("applies addColumn through withTransaction and records bookkeeping", async () => {
    const pgl = new PGlite();
    const pool = pgl as unknown as Pool;

    const v0 = new PostgresTabularStorage(
      pool,
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

    const migrations: ITabularMigration[] = [
      {
        version: 1,
        description: "add archived",
        ops: [
          {
            kind: "addColumn",
            name: "archived",
            // Nullable schema: ALTER TABLE ADD COLUMN NOT NULL fails on a
            // populated table without a default.
            schema: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          },
        ],
      },
    ];
    const v1 = new PostgresTabularStorage(
      pool,
      "users",
      {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          archived: { anyOf: [{ type: "boolean" }, { type: "null" }] },
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

    const r = await pgl.query("SELECT version FROM _storage_migrations WHERE component = $1", [
      "tabular:users",
    ]);
    expect((r.rows as Array<{ version: number }>).map((x) => Number(x.version))).toEqual([1]);

    const row = (await v1.get({ id: "u1" })) as
      | { id: string; name: string; archived?: boolean | null }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.archived ?? null).toBeNull();

    await pgl.close();
  });
});
