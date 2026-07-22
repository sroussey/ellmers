/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyTabularStorage } from "@workglow/storage";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * SQL-backend-only bulk-put contract: the multi-row `INSERT … RETURNING *`
 * path returns the final committed row for every duplicate-key position, emits
 * one `put` event per distinct committed row, and is all-or-nothing on a
 * mid-batch failure. Invoked by the SQLite, Postgres, and DuckDB test files
 * with a fresh, already-set-up repository whose schema is:
 * PK { name, type }, values { option, success }.
 */
export function runSqlBulkPutTests(createRepo: () => Promise<AnyTabularStorage>): void {
  describe("SQL bulk putBulk", () => {
    let repo: AnyTabularStorage;

    beforeEach(async () => {
      repo = await createRepo();
    });

    it("returns the final committed row for every duplicate-key position", async () => {
      const entities = [
        { name: "d", type: "k", option: "first", success: true },
        { name: "d", type: "k", option: "last", success: false },
      ];

      const returned = await repo.putBulk(entities);

      expect(returned).toHaveLength(2);
      // Both positions reflect the final committed row (last write wins).
      expect(returned[0].option).toEqual("last");
      expect(returned[1].option).toEqual("last");
    });

    it("emits one put event per distinct committed row", async () => {
      const events: unknown[] = [];
      repo.on("put", (e) => events.push(e));

      await repo.putBulk([
        { name: "d", type: "k", option: "first", success: true },
        { name: "e", type: "k", option: "kept", success: true },
        { name: "d", type: "k", option: "last", success: false },
      ]);

      expect(events).toHaveLength(2);
    });

    it("rolls the whole batch back when one row violates a constraint", async () => {
      await repo.putBulk([{ name: "a", type: "k", option: "ok", success: true }]);

      const rollbacks: unknown[] = [];
      repo.on("rollback", (r) => rollbacks.push(r));

      // A null in a NOT NULL required value column fails mid-batch.
      const bad = [
        { name: "b", type: "k", option: "ok", success: true },
        { name: "c", type: "k", option: null as unknown as string, success: true },
      ];
      await expect(repo.putBulk(bad)).rejects.toBeDefined();

      // Neither b nor c persisted; the pre-existing row is untouched.
      expect(await repo.get({ name: "b", type: "k" })).toBeUndefined();
      expect(await repo.get({ name: "c", type: "k" })).toBeUndefined();
      expect((await repo.get({ name: "a", type: "k" }))?.option).toEqual("ok");
      expect(rollbacks).toHaveLength(1);
    });
  });
}
