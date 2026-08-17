/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "../InMemoryTabularStorage";
import { StorageValidationError } from "../StorageError";

/**
 * `note` is required *and* nullable — the one combination where "must be
 * present" and "must not be null" come apart, and the case that catches an
 * implementation that folds the two constraints into one flag.
 */
const ConstraintSchema = {
  type: "object",
  properties: {
    id: { type: "string", maxLength: 8 },
    name: { type: "string", maxLength: 10 },
    email: { type: "string", format: "email" },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
    optional: { type: "string", maxLength: 4 },
    count: { type: "integer" },
  },
  required: ["id", "name", "email", "note", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const ConstraintPK = ["id"] as const;

const validRow = {
  id: "row-1",
  name: "Ada",
  email: "ada@example.com",
  note: null,
  count: 1,
};

const AutoKeySchema = {
  type: "object",
  properties: {
    id: { type: "string", "x-auto-generated": true },
    title: { type: "string", maxLength: 5 },
  },
  required: ["id", "title"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const AutoKeyPK = ["id"] as const;

/**
 * `score` maps to SMALLINT (unsigned, maximum fits), so it carries both a
 * schema bound and a narrower-than-INTEGER column range. `offset` is signed and
 * `ratio` is a float, so neither picks up an integer range.
 */
const NumericSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    offset: { type: "integer" },
    big: { type: "integer", minimum: 0 },
    ratio: { type: "number", minimum: 0, maximum: 1 },
    bounded: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 10 },
    unbounded: { type: "number" },
  },
  required: ["id", "score", "offset", "big", "ratio", "bounded", "unbounded"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const NumericPK = ["id"] as const;

const validNumericRow = {
  id: "n-1",
  score: 50,
  offset: -5,
  big: 1,
  ratio: 0.5,
  bounded: 5,
  unbounded: 1.25,
};

describe("InMemoryTabularStorage column constraints", () => {
  let storage: InMemoryTabularStorage<typeof ConstraintSchema, typeof ConstraintPK>;

  beforeEach(async () => {
    storage = new InMemoryTabularStorage(ConstraintSchema, ConstraintPK);
    await storage.setupDatabase();
  });

  describe("NOT NULL", () => {
    it("accepts a row that satisfies every column constraint", async () => {
      await storage.put(validRow);
      expect(await storage.size()).toBe(1);
    });

    it("rejects a missing required value column", async () => {
      const { name: _dropped, ...withoutName } = validRow;
      await expect(storage.put(withoutName as never)).rejects.toThrow(
        "Missing required value field: name"
      );
    });

    it("rejects an explicit null in a NOT NULL column", async () => {
      await expect(storage.put({ ...validRow, name: null } as never)).rejects.toThrow(
        "NOT NULL constraint failed: name"
      );
    });

    it("rejects a missing primary key", async () => {
      const { id: _dropped, ...withoutId } = validRow;
      await expect(storage.put(withoutId as never)).rejects.toThrow(
        "Missing required primary key field: id"
      );
    });

    it("rejects a null primary key", async () => {
      await expect(storage.put({ ...validRow, id: null } as never)).rejects.toThrow(
        "Primary key field id cannot be null"
      );
    });

    it("accepts a null in a required-but-nullable column", async () => {
      await storage.put({ ...validRow, note: null });
      expect((await storage.get({ id: "row-1" }))?.note).toBeNull();
    });

    it("still requires a required-but-nullable column to be present", async () => {
      const { note: _dropped, ...withoutNote } = validRow;
      await expect(storage.put(withoutNote as never)).rejects.toThrow(
        "Missing required value field: note"
      );
    });

    it("accepts an optional column that is absent or null", async () => {
      await storage.put(validRow);
      await storage.put({ ...validRow, id: "row-2", optional: null } as never);
      expect(await storage.size()).toBe(2);
    });

    it("throws StorageValidationError", async () => {
      await expect(storage.put({ ...validRow, name: null } as never)).rejects.toBeInstanceOf(
        StorageValidationError
      );
    });

    it("counts an auto-generated key as supplied", async () => {
      const autoKeyStorage = new InMemoryTabularStorage(AutoKeySchema, AutoKeyPK);
      await autoKeyStorage.setupDatabase();

      const stored = await autoKeyStorage.put({ title: "abc" });

      expect(typeof stored.id).toBe("string");
      expect(stored.id.length).toBeGreaterThan(0);
    });
  });

  describe("VARCHAR width", () => {
    it("rejects a value wider than the declared maxLength", async () => {
      await expect(storage.put({ ...validRow, name: "Ada Lovelace!" } as never)).rejects.toThrow(
        'value too long for type character varying(10): column "name" is 13 characters'
      );
    });

    it("accepts a value exactly at the declared maxLength", async () => {
      await storage.put({ ...validRow, name: "0123456789" });
      expect((await storage.get({ id: "row-1" }))?.name).toBe("0123456789");
    });

    it("enforces the width a string format implies", async () => {
      const longEmail = `${"a".repeat(250)}@example.com`;
      await expect(storage.put({ ...validRow, email: longEmail } as never)).rejects.toThrow(
        "value too long for type character varying(255)"
      );

      const atLimit = `${"a".repeat(243)}@example.com`;
      await storage.put({ ...validRow, email: atLimit });
      expect((await storage.get({ id: "row-1" }))?.email).toBe(atLimit);
    });

    it("enforces the width of a primary-key column", async () => {
      await expect(storage.put({ ...validRow, id: "much-too-long" } as never)).rejects.toThrow(
        'column "id" is 13 characters'
      );
    });

    it("measures characters, not UTF-16 code units", async () => {
      // Ten emoji are 20 code units but 10 characters — a VARCHAR(10) column
      // takes them.
      await storage.put({ ...validRow, name: "😀".repeat(10) });
      expect((await storage.get({ id: "row-1" }))?.name).toBe("😀".repeat(10));

      await expect(storage.put({ ...validRow, name: "😀".repeat(11) } as never)).rejects.toThrow(
        'column "name" is 11 characters'
      );
    });

    it("leaves an unbounded string column alone", async () => {
      await storage.put({ ...validRow, note: "n".repeat(10_000) });
      expect((await storage.get({ id: "row-1" }))?.note?.length).toBe(10_000);
    });
  });

  describe("numeric bounds", () => {
    let numeric: InMemoryTabularStorage<typeof NumericSchema, typeof NumericPK>;

    beforeEach(async () => {
      numeric = new InMemoryTabularStorage(NumericSchema, NumericPK);
      await numeric.setupDatabase();
    });

    it("accepts a row inside every bound", async () => {
      await numeric.put(validNumericRow);
      expect(await numeric.size()).toBe(1);
    });

    it("rejects a value below the schema minimum", async () => {
      await expect(numeric.put({ ...validNumericRow, score: -1 } as never)).rejects.toThrow(
        'value -1 for column "score" is below the schema minimum 0'
      );
    });

    it("rejects a value above the schema maximum", async () => {
      await expect(numeric.put({ ...validNumericRow, score: 101 } as never)).rejects.toThrow(
        'value 101 for column "score" is above the schema maximum 100'
      );
    });

    it("accepts values exactly on an inclusive bound", async () => {
      await numeric.put({ ...validNumericRow, score: 0, ratio: 0 });
      await numeric.put({ ...validNumericRow, id: "n-2", score: 100, ratio: 1 });
      expect(await numeric.size()).toBe(2);
    });

    it("rejects values sitting on an exclusive bound", async () => {
      await expect(numeric.put({ ...validNumericRow, bounded: 0 } as never)).rejects.toThrow(
        'value 0 for column "bounded" is not above the schema exclusiveMinimum 0'
      );
      await expect(numeric.put({ ...validNumericRow, bounded: 10 } as never)).rejects.toThrow(
        'value 10 for column "bounded" is not below the schema exclusiveMaximum 10'
      );
    });

    it("accepts values just inside an exclusive bound", async () => {
      await numeric.put({ ...validNumericRow, bounded: 0.001 });
      expect((await numeric.get({ id: "n-1" }))?.bounded).toBe(0.001);
    });

    it("rejects a non-integer in an integer column", async () => {
      await expect(numeric.put({ ...validNumericRow, offset: 1.5 } as never)).rejects.toThrow(
        'column "offset" is INTEGER but got a non-integer value: 1.5'
      );
    });

    it("allows a fractional value in a float column", async () => {
      await numeric.put({ ...validNumericRow, ratio: 0.125 });
      expect((await numeric.get({ id: "n-1" }))?.ratio).toBe(0.125);
    });

    it("rejects an integer overflowing its column range", async () => {
      // `offset` has no declared bounds at all, so only the INTEGER column
      // range stands between the caller and a silent overflow.
      await expect(
        numeric.put({ ...validNumericRow, offset: 2147483648 } as never)
      ).rejects.toThrow('value 2147483648 is out of range for type integer: column "offset"');
    });

    it("applies the wider BIGINT range to an unbounded-above unsigned column", async () => {
      // `big` is unsigned with no maximum, so the DDL widens it to BIGINT — a
      // value INTEGER could not hold must still be accepted here.
      await numeric.put({ ...validNumericRow, big: 4294967296 });
      expect((await numeric.get({ id: "n-1" }))?.big).toBe(4294967296);

      await expect(numeric.put({ ...validNumericRow, big: 1e19 } as never)).rejects.toThrow(
        "out of range for type bigint"
      );
    });

    it("leaves a column with neither bounds nor an integer range alone", async () => {
      await numeric.put({ ...validNumericRow, unbounded: -1e12 });
      expect((await numeric.get({ id: "n-1" }))?.unbounded).toBe(-1e12);
    });

    it("rejects an out-of-range patch in updateWhere and keeps the row intact", async () => {
      await numeric.put(validNumericRow);
      await expect(numeric.updateWhere({ id: "n-1" }, { score: 500 } as never)).rejects.toThrow(
        'value 500 for column "score" is above the schema maximum 100'
      );
      expect((await numeric.get({ id: "n-1" }))?.score).toBe(50);
    });

    it("throws StorageValidationError", async () => {
      await expect(numeric.put({ ...validNumericRow, score: 999 } as never)).rejects.toBeInstanceOf(
        StorageValidationError
      );
    });
  });

  describe("constraint mode", () => {
    /**
     * The 8th constructor parameter is the constraint mode. Everything before
     * it is spelled out so the mode lands in the right position.
     */
    function makeStorage<
      S extends DataPortSchemaObject,
      PK extends readonly (keyof S["properties"])[],
    >(
      schema: S,
      primaryKeyNames: PK,
      mode: "postgres" | "sqlite" | "off"
    ): InMemoryTabularStorage<S, PK> {
      return new InMemoryTabularStorage<S, PK>(
        schema,
        primaryKeyNames,
        [],
        "if-missing",
        undefined,
        "inmemory",
        [],
        mode
      );
    }

    it("postgres is the default mode", async () => {
      // Constructed with the pre-existing 7-argument call: the new parameter is
      // additive, so an untouched caller keeps the Postgres-shaped rules.
      const storage = new InMemoryTabularStorage(
        ConstraintSchema,
        ConstraintPK,
        [],
        "if-missing",
        undefined,
        "inmemory",
        []
      );
      await storage.setupDatabase();
      await expect(storage.put({ ...validRow, name: "Ada Lovelace!" } as never)).rejects.toThrow(
        StorageValidationError
      );
    });

    it("sqlite mode accepts a value wider than maxLength, as a SQLite TEXT column does", async () => {
      // `SqliteTabularStorage.mapTypeToSQL` emits `TEXT /* VARCHAR(n) */` — the
      // width is a COMMENT, and SQLite enforces no character width at all. A
      // double that rejects the value is stricter than the backend it stands in
      // for.
      const storage = makeStorage(ConstraintSchema, ConstraintPK, "sqlite");
      await storage.setupDatabase();
      await storage.put({ ...validRow, name: "Ada Lovelace!" } as never);
      expect((await storage.get({ id: "row-1" }))?.name).toBe("Ada Lovelace!");
    });

    it("sqlite mode accepts an integer outside the Postgres column range", async () => {
      // `score` maps to SMALLINT on Postgres (max 32767). SQLite emits a bare
      // `INTEGER` with no width selection, so 40000 stores fine there.
      const storage = makeStorage(NumericSchema, NumericPK, "sqlite");
      await storage.setupDatabase();
      await storage.put({ ...validNumericRow, score: 40000 } as never);
      expect((await storage.get({ id: "n-1" }))?.score).toBe(40000);
    });

    it("sqlite mode accepts a value outside the schema's declared bounds", async () => {
      // Schema bounds are emitted as a CHECK by no backend at all, so they are
      // the first thing a backend-scoped mode drops.
      const storage = makeStorage(NumericSchema, NumericPK, "sqlite");
      await storage.setupDatabase();
      await storage.put({ ...validNumericRow, ratio: 42 } as never);
      expect((await storage.get({ id: "n-1" }))?.ratio).toBe(42);
    });

    it("sqlite mode still rejects a missing required column", async () => {
      const storage = makeStorage(ConstraintSchema, ConstraintPK, "sqlite");
      await storage.setupDatabase();
      const { name: _dropped, ...withoutName } = validRow;
      await expect(storage.put(withoutName as never)).rejects.toThrow(
        "Missing required value field: name"
      );
    });

    it("sqlite mode still rejects an explicit null in a NOT NULL column", async () => {
      const storage = makeStorage(ConstraintSchema, ConstraintPK, "sqlite");
      await storage.setupDatabase();
      await expect(storage.put({ ...validRow, name: null } as never)).rejects.toThrow(
        "NOT NULL constraint failed: name"
      );

      // `note` is required but nullable, so an explicit null stays legal — the
      // presence and NOT NULL halves are still two separate checks here.
      await storage.put({ ...validRow, note: null } as never);
      expect((await storage.get({ id: "row-1" }))?.note).toBeNull();
    });

    it("off mode accepts a row postgres mode rejects", async () => {
      // One row failing width (name), integer range (count overflows INTEGER)
      // and NOT NULL (email) simultaneously.
      const offending = { ...validRow, name: "Ada Lovelace!", email: null, count: 3_000_000_000 };

      const postgres = makeStorage(ConstraintSchema, ConstraintPK, "postgres");
      await postgres.setupDatabase();
      await expect(postgres.put(offending as never)).rejects.toThrow(StorageValidationError);

      const off = makeStorage(ConstraintSchema, ConstraintPK, "off");
      await off.setupDatabase();
      await off.put(offending as never);
      expect(await off.size()).toBe(1);
    });
  });

  describe("write atomicity", () => {
    it("stores nothing when a single put is rejected", async () => {
      await expect(storage.put({ ...validRow, name: null } as never)).rejects.toThrow();
      expect(await storage.size()).toBe(0);
    });

    it("rolls the whole batch back when one row violates a constraint", async () => {
      await expect(
        storage.putBulk([
          validRow,
          { ...validRow, id: "row-2" },
          { ...validRow, id: "row-3", name: null },
        ] as never)
      ).rejects.toThrow("NOT NULL constraint failed: name");

      expect(await storage.size()).toBe(0);
    });

    it("commits a batch in which every row is valid", async () => {
      await storage.putBulk([validRow, { ...validRow, id: "row-2" }]);
      expect(await storage.size()).toBe(2);
    });
  });

  describe("updateWhere", () => {
    beforeEach(async () => {
      await storage.put(validRow);
    });

    it("rejects a patch that nulls a NOT NULL column and leaves the row intact", async () => {
      await expect(storage.updateWhere({ id: "row-1" }, { name: null } as never)).rejects.toThrow(
        "NOT NULL constraint failed: name"
      );

      expect((await storage.get({ id: "row-1" }))?.name).toBe("Ada");
    });

    it("rejects a patch that overflows a VARCHAR width", async () => {
      await expect(
        storage.updateWhere({ id: "row-1" }, { name: "Ada Lovelace!" } as never)
      ).rejects.toThrow("value too long for type character varying(10)");

      expect((await storage.get({ id: "row-1" }))?.name).toBe("Ada");
    });

    it("applies a patch that satisfies the constraints", async () => {
      await storage.updateWhere({ id: "row-1" }, { name: "Grace" });
      expect((await storage.get({ id: "row-1" }))?.name).toBe("Grace");
    });

    it("allows a patch nulling a required-but-nullable column", async () => {
      await storage.updateWhere({ id: "row-1" }, { note: "hi" });
      await storage.updateWhere({ id: "row-1" }, { note: null });
      expect((await storage.get({ id: "row-1" }))?.note).toBeNull();
    });
  });
});
