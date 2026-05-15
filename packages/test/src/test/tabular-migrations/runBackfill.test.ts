/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage, runBackfill } from "@workglow/storage";
import { describe, expect, it } from "vitest";

describe("runBackfill", () => {
  const schema = {
    type: "object",
    properties: { id: { type: "string" }, n: { type: "integer" } },
    required: ["id", "n"],
    additionalProperties: false,
  } as const;

  it("rewrites every row with the transform output", async () => {
    const storage = new InMemoryTabularStorage(schema, ["id"] as const);
    await storage.setupDatabase();
    for (let i = 0; i < 25; i++) {
      await storage.put({ id: `r${i}`, n: i });
    }
    await runBackfill(storage as any, 10, (row) => ({ ...row, n: (row.n as number) * 10 }));
    const all = (await storage.getAll())!;
    expect(all.find((r) => r.id === "r3")?.n).toBe(30);
    expect(all).toHaveLength(25);
  });

  it("deletes rows when transform returns undefined", async () => {
    const storage = new InMemoryTabularStorage(schema, ["id"] as const);
    await storage.setupDatabase();
    for (let i = 0; i < 5; i++) await storage.put({ id: `r${i}`, n: i });
    await runBackfill(storage as any, 10, (row) => ((row.n as number) % 2 === 0 ? undefined : row));
    expect(await storage.size()).toBe(2);
  });

  it("skips writes when transform returns the same row", async () => {
    const storage = new InMemoryTabularStorage(schema, ["id"] as const);
    await storage.setupDatabase();
    let writes = 0;
    storage.on("put", () => writes++);
    await storage.put({ id: "r1", n: 1 });
    writes = 0;
    await runBackfill(storage as any, 10, (row) => row);
    expect(writes).toBe(0);
  });
});
