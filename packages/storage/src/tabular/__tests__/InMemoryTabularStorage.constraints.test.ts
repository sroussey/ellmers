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
