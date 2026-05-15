/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import type { ITabularMigration } from "@workglow/storage";
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

describe("IndexedDbTabular migration smoke", () => {
  it("runs a backfill migration over existing rows", async () => {
    const dbName = "users_smoke_idb";
    const v0 = new IndexedDbTabularStorage(
      dbName,
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
    await v0.put({ id: "u2", name: "BOB" });

    const migrations: ITabularMigration[] = [
      {
        version: 1,
        description: "lowercase names",
        ops: [
          {
            kind: "backfill",
            transform: (row) => ({
              ...row,
              name: ((row as Record<string, unknown>).name as string).toLowerCase(),
            }),
          },
        ],
      },
    ];
    const v1 = new IndexedDbTabularStorage(
      dbName,
      {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const,
      [],
      {},
      "if-missing",
      migrations
    );
    await v1.setupDatabase();

    const all = (await v1.getAll()) ?? [];
    const u2 = all.find((r) => (r as { id: string }).id === "u2") as { name: string } | undefined;
    expect(u2).toBeDefined();
    expect(u2!.name).toBe("bob");
  });
});
