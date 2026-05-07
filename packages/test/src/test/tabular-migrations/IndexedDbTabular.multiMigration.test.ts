/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import type { ITabularMigration } from "@workglow/storage";

describe("IndexedDbTabular multi-migration", () => {
  it("applies two pending migrations in order without re-entering setupDatabase", async () => {
    // Pre-populate the DB so the orchestrator takes the run-pending path
    // (not the fresh-DB fast path) for both migrations.
    const dbName = "users_multi_mig";
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
    // Sanity: v0 wrote 2 rows.
    expect(await v0.size()).toBe(2);

    let backfill1Calls = 0;
    let backfill2Calls = 0;
    const migrations: ITabularMigration[] = [
      {
        version: 1,
        description: "lowercase names",
        ops: [
          {
            kind: "backfill",
            transform: (row) => {
              backfill1Calls++;
              const r = row as { id: string; name: string };
              return { ...r, name: r.name.toLowerCase() };
            },
          },
          { kind: "addIndex", name: "idx_name", columns: ["name"] },
        ],
      },
      {
        version: 2,
        description: "uppercase first letter",
        ops: [
          {
            kind: "backfill",
            transform: (row) => {
              backfill2Calls++;
              const r = row as { id: string; name: string };
              return { ...r, name: r.name.charAt(0).toUpperCase() + r.name.slice(1) };
            },
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

    // Each backfill should run exactly twice (once per row, once per
    // migration). If the recursion bug fires, backfill2Calls will exceed 2
    // (recursive setupDatabase re-runs the orchestrator, replaying it).
    expect(backfill1Calls).toBe(2);
    expect(backfill2Calls).toBe(2);

    // Final row state: lowercased then capitalized = "Alice", "Bob".
    const all = (await v1.getAll())!.sort((a, b) =>
      (a as { id: string }).id.localeCompare((b as { id: string }).id)
    );
    expect(all.map((r) => (r as { name: string }).name)).toEqual(["Alice", "Bob"]);
  });
});
