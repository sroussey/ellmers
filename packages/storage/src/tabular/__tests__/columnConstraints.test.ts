/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject, JsonSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { mapPostgresType } from "../../sql/mapPostgresType";
import {
  assertColumnConstraints,
  buildColumnConstraints,
  getNonNullSchema,
  isNullableSchema,
  varcharWidth,
  varcharWidthForFormat,
} from "../columnConstraints";
import { StorageValidationError } from "../StorageError";

const nullable = (inner: JsonSchema): JsonSchema =>
  ({ anyOf: [inner, { type: "null" }] }) as JsonSchema;

describe("isNullableSchema", () => {
  it("reports a plain type as non-nullable", () => {
    expect(isNullableSchema({ type: "string" } as JsonSchema)).toBe(false);
  });

  it("reports the null type itself as nullable", () => {
    expect(isNullableSchema({ type: "null" } as JsonSchema)).toBe(true);
  });

  it("reports a type-array containing null as nullable", () => {
    expect(isNullableSchema({ type: ["string", "null"] } as JsonSchema)).toBe(true);
  });

  it("reports an anyOf/oneOf union containing null as nullable", () => {
    expect(isNullableSchema(nullable({ type: "number" } as JsonSchema))).toBe(true);
    expect(isNullableSchema({ oneOf: [{ type: "number" }, { type: "null" }] } as JsonSchema)).toBe(
      true
    );
  });
});

describe("getNonNullSchema", () => {
  it("unwraps the non-null branch of a union", () => {
    expect(getNonNullSchema(nullable({ type: "string", maxLength: 3 } as JsonSchema))).toEqual({
      type: "string",
      maxLength: 3,
    });
  });

  it("is idempotent on an already-resolved schema", () => {
    const resolved = { type: "string" } as JsonSchema;
    expect(getNonNullSchema(getNonNullSchema(resolved))).toEqual(resolved);
  });
});

describe("varcharWidth", () => {
  it("reads an explicit maxLength", () => {
    expect(varcharWidth({ type: "string", maxLength: 42 } as JsonSchema)).toBe(42);
  });

  it("returns undefined for an unbounded string (a TEXT column)", () => {
    expect(varcharWidth({ type: "string" } as JsonSchema)).toBeUndefined();
  });

  it("derives the implied width of the email and uri formats", () => {
    expect(varcharWidth({ type: "string", format: "email" } as JsonSchema)).toBe(255);
    expect(varcharWidth({ type: "string", format: "uri" } as JsonSchema)).toBe(2048);
  });

  it("lets a format's implied width win over maxLength, as the DDL does", () => {
    // Postgres emits VARCHAR(255) for `format: email` regardless of maxLength,
    // so that — not the maxLength — is the width actually enforced.
    expect(varcharWidth({ type: "string", format: "email", maxLength: 10 } as JsonSchema)).toBe(
      255
    );
  });

  it("returns undefined for formats that map to a dedicated column type", () => {
    for (const format of ["date-time", "date", "uuid"]) {
      expect(varcharWidth({ type: "string", format, maxLength: 12 } as JsonSchema)).toBeUndefined();
    }
  });

  it("returns undefined for a blob column, whose maxLength counts bytes", () => {
    expect(
      varcharWidth({ type: "string", contentEncoding: "blob", maxLength: 16 } as JsonSchema)
    ).toBeUndefined();
  });

  it("unwraps a nullable union before reading the width", () => {
    expect(varcharWidth(nullable({ type: "string", maxLength: 7 } as JsonSchema))).toBe(7);
  });

  it("returns undefined for non-string types", () => {
    expect(varcharWidth({ type: "integer" } as JsonSchema)).toBeUndefined();
    expect(
      varcharWidth({ type: "array", items: { type: "string" } } as JsonSchema)
    ).toBeUndefined();
    expect(varcharWidth(true as unknown as JsonSchema)).toBeUndefined();
  });
});

describe("varcharWidth agrees with the VARCHAR width mapPostgresType emits", () => {
  // The whole point of enforcing width in the schemaless backends is that they
  // reject what Postgres would. Walk the same schemas through both and assert
  // they never disagree — if someone adds a width rule to one, this fails.
  const cases: JsonSchema[] = [
    { type: "string" },
    { type: "string", maxLength: 1 },
    { type: "string", maxLength: 512 },
    { type: "string", format: "email" },
    { type: "string", format: "email", maxLength: 10 },
    { type: "string", format: "uri" },
    { type: "string", format: "uuid" },
    { type: "string", format: "uuid", maxLength: 12 },
    { type: "string", format: "date-time" },
    { type: "string", format: "date" },
    { type: "string", format: "hostname", maxLength: 63 },
    { type: "string", contentEncoding: "blob", maxLength: 16 },
    nullable({ type: "string", maxLength: 20 }),
    { type: "integer" },
    { type: "boolean" },
  ] as JsonSchema[];

  it.each(cases.map((schema) => [JSON.stringify(schema), schema] as const))(
    "%s",
    (_label, schema) => {
      const sqlType = mapPostgresType(schema, { getNonNullType: getNonNullSchema });
      const declaredWidth = varcharWidth(schema);
      const emittedWidth = /^VARCHAR\((\d+)\)$/.exec(sqlType)?.[1];

      expect(emittedWidth === undefined ? undefined : Number(emittedWidth)).toBe(declaredWidth);
    }
  );

  it("exposes the format widths the DDL uses", () => {
    expect(varcharWidthForFormat("email")).toBe(255);
    expect(varcharWidthForFormat("uri")).toBe(2048);
    expect(varcharWidthForFormat("uuid")).toBeUndefined();
    expect(varcharWidthForFormat(undefined)).toBeUndefined();
  });
});

describe("buildColumnConstraints", () => {
  const primaryKeySchema = {
    type: "object",
    properties: {
      id: { type: "string", maxLength: 8 },
    },
    // Deliberately empty: a primary key is NOT NULL in the emitted DDL whether
    // or not the schema bothered to list it as required.
    required: [],
    additionalProperties: false,
  } as unknown as DataPortSchemaObject;

  const valueSchema = {
    type: "object",
    properties: {
      name: { type: "string", maxLength: 10 },
      note: nullable({ type: "string" } as JsonSchema),
      extra: { type: "string" },
    },
    required: ["name", "note"],
    additionalProperties: false,
  } as unknown as DataPortSchemaObject;

  const byColumn = Object.fromEntries(
    buildColumnConstraints(primaryKeySchema, valueSchema).map((c) => [c.column, c])
  );

  it("marks a primary key required and NOT NULL regardless of `required`", () => {
    expect(byColumn.id).toMatchObject({
      isPrimaryKey: true,
      required: true,
      notNull: true,
      maxLength: 8,
    });
  });

  it("marks a required non-nullable value column NOT NULL", () => {
    expect(byColumn.name).toMatchObject({
      isPrimaryKey: false,
      required: true,
      notNull: true,
      maxLength: 10,
    });
  });

  it("marks a required nullable value column present-but-nullable", () => {
    // `required` and `NOT NULL` are separate constraints: the SQL backends
    // demand the field be supplied, but the column accepts a null.
    expect(byColumn.note).toMatchObject({ required: true, notNull: false });
  });

  it("leaves an optional column unconstrained", () => {
    expect(byColumn.extra).toMatchObject({
      required: false,
      notNull: false,
      maxLength: undefined,
    });
  });
});

describe("assertColumnConstraints", () => {
  const constraints = buildColumnConstraints(
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    } as unknown as DataPortSchemaObject,
    {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 4 },
        note: nullable({ type: "string" } as JsonSchema),
        extra: { type: "string" },
      },
      required: ["name", "note"],
      additionalProperties: false,
    } as unknown as DataPortSchemaObject
  );

  it("accepts a row satisfying every constraint", () => {
    expect(() =>
      assertColumnConstraints({ id: "a", name: "abcd", note: null }, constraints)
    ).not.toThrow();
  });

  it("names the offending primary-key column", () => {
    expect(() => assertColumnConstraints({ name: "ab", note: null }, constraints)).toThrow(
      "Missing required primary key field: id"
    );
    expect(() =>
      assertColumnConstraints({ id: null, name: "ab", note: null }, constraints)
    ).toThrow("Primary key field id cannot be null");
  });

  it("distinguishes an absent required column from an explicit null", () => {
    expect(() => assertColumnConstraints({ id: "a", note: null }, constraints)).toThrow(
      "Missing required value field: name"
    );
    expect(() => assertColumnConstraints({ id: "a", name: null, note: null }, constraints)).toThrow(
      "NOT NULL constraint failed: name"
    );
  });

  it("treats an explicit undefined the same as an absent column", () => {
    expect(() =>
      assertColumnConstraints({ id: "a", name: undefined, note: null }, constraints)
    ).toThrow("Missing required value field: name");
  });

  it("throws StorageValidationError so callers can catch one error type", () => {
    expect(() => assertColumnConstraints({}, constraints)).toThrow(StorageValidationError);
  });

  it("reports an over-long value with the declared width", () => {
    expect(() =>
      assertColumnConstraints({ id: "a", name: "abcde", note: null }, constraints)
    ).toThrow('value too long for type character varying(4): column "name" is 5 characters');
  });

  it("accepts a value exactly at the declared width", () => {
    expect(() =>
      assertColumnConstraints({ id: "a", name: "abcd", note: null }, constraints)
    ).not.toThrow();
  });

  it("counts characters, not UTF-16 code units", () => {
    // Four emoji are 8 code units but 4 characters, which is what a
    // VARCHAR(4) column actually measures.
    expect(() =>
      assertColumnConstraints({ id: "a", name: "😀😀😀😀", note: null }, constraints)
    ).not.toThrow();
    expect(() =>
      assertColumnConstraints({ id: "a", name: "😀😀😀😀😀", note: null }, constraints)
    ).toThrow('column "name" is 5 characters');
  });

  it("ignores width for a non-string value", () => {
    expect(() =>
      assertColumnConstraints({ id: "a", name: 123456789, note: null }, constraints)
    ).not.toThrow();
  });

  it("allows an optional column to be absent or null", () => {
    expect(() =>
      assertColumnConstraints({ id: "a", name: "ab", note: null, extra: null }, constraints)
    ).not.toThrow();
  });
});
