/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresTabularStorage, dateToSchemaString } from "@workglow/postgres/storage";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

describe("dateToSchemaString", () => {
  it("renders a timestamp from the local frame node-postgres parses into", () => {
    // `postgres-date` turns the stored wall-clock "2026-08-06 20:27:40.656"
    // into a Date whose LOCAL components are those digits. toISOString() would
    // re-apply the session offset and report a different hour (and, near
    // midnight, a different day).
    const parsedLikePg = new Date(2026, 7, 6, 20, 27, 40, 656);
    expect(dateToSchemaString(parsedLikePg, "date-time")).toBe("2026-08-06T20:27:40.656Z");
  });

  it("renders a DATE from whichever frame the driver put midnight in", () => {
    // node-postgres: local midnight.
    expect(dateToSchemaString(new Date(2026, 3, 2, 0, 0, 0, 0), "date")).toBe("2026-04-02");
    // PGlite: UTC midnight. Reading local components here would say 2026-04-01
    // anywhere west of Greenwich.
    expect(dateToSchemaString(new Date("2026-04-02T00:00:00.000Z"), "date")).toBe("2026-04-02");
  });
});

/**
 * A schema declaring `type: "string"` date columns. `mapPostgresType` turns
 * `format: "date-time"` into TIMESTAMP and `format: "date"` into DATE, and the
 * driver hydrates both into JS `Date` — so without coercion a caller receives a
 * value its own schema says is impossible. SQLite stores these as TEXT and
 * returns strings, which is why the divergence stays invisible until something
 * string-shaped (sorting a history table by `valid_from`) runs on Postgres.
 */
const HistorySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    valid_from: { type: "string", format: "date-time" },
    valid_to: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    effective_on: { type: "string", format: "date" },
  },
  required: ["id", "valid_from", "effective_on"],
  additionalProperties: false,
} as const;

async function storage() {
  const s = new PostgresTabularStorage(new PGlite() as unknown as Pool, "history", HistorySchema, [
    "id",
  ] as const);
  await s.setupDatabase();
  return s;
}

describe("PostgresTabularStorage date-typed string columns", () => {
  it("returns strings, not Date objects, for date-time and date columns", async () => {
    const s = await storage();
    await s.put({
      id: "h1",
      valid_from: "2026-04-02T07:00:00.001Z",
      valid_to: null,
      effective_on: "2026-04-02",
    });

    const row = await s.get({ id: "h1" });
    expect(typeof row?.valid_from).toBe("string");
    expect(typeof row?.effective_on).toBe("string");
    expect(row?.valid_to).toBeNull();
  });

  it("round-trips the exact wall-clock without a timezone shift", async () => {
    // TIMESTAMP WITHOUT TIME ZONE keeps the wall-clock it is given and drops
    // the offset, so the stored value is the UTC clock we wrote. Reading it
    // back through `toISOString()` would re-apply the session offset and shift
    // the value (7 hours in America/Los_Angeles) — the bug this guards.
    const s = await storage();
    await s.put({
      id: "h1",
      valid_from: "2026-04-02T07:00:00.001Z",
      valid_to: "2026-08-06T20:27:40.656Z",
      effective_on: "2026-04-02",
    });

    const row = await s.get({ id: "h1" });
    expect(row?.valid_from).toBe("2026-04-02T07:00:00.001Z");
    expect(row?.valid_to).toBe("2026-08-06T20:27:40.656Z");
    expect(row?.effective_on).toBe("2026-04-02");
  });

  it("sorts by a date-time column the way callers assume it can", async () => {
    // The original failure: `rows.sort((a, b) => a.valid_from.localeCompare(...))`
    // threw "localeCompare is not a function" once a second row existed.
    const s = await storage();
    await s.put({
      id: "b",
      valid_from: "2026-04-02T07:00:00.001Z",
      valid_to: null,
      effective_on: "2026-04-02",
    });
    await s.put({
      id: "a",
      valid_from: "2026-04-02T00:00:00.000Z",
      valid_to: null,
      effective_on: "2026-04-02",
    });

    const rows = await s.getAll();
    expect(() => rows.sort((x, y) => x.valid_from.localeCompare(y.valid_from))).not.toThrow();
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
