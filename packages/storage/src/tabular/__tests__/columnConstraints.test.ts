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
  numericBounds,
  sqlIntegerTypeFor,
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

  it("collapses the `type: [T, null]` array spelling to T", () => {
    // RunUsageSchema and friends use this form. Leaving the array intact made
    // every caller switching on `type` fall through to its unknown-type branch.
    expect(getNonNullSchema({ type: ["integer", "null"] } as JsonSchema)).toMatchObject({
      type: "integer",
    });
  });

  it("keeps sibling keywords when collapsing the array spelling", () => {
    expect(
      getNonNullSchema({ type: ["string", "null"], maxLength: 10 } as JsonSchema)
    ).toMatchObject({ type: "string", maxLength: 10 });
  });

  it("leaves a genuine multi-type union as an array", () => {
    // No single SQL type describes it, so the honest answer is to keep falling
    // through to the callers' unknown-type handling.
    const union = { type: ["string", "integer", "null"] } as JsonSchema;
    expect((getNonNullSchema(union) as { type: unknown }).type).toEqual([
      "string",
      "integer",
      "null",
    ]);
  });
});

describe("the `type: [T, null]` spelling derives the same constraints as anyOf", () => {
  // Regression guard: these two spellings of "nullable T" must not produce
  // different columns. They did — the array form silently became
  // `TEXT /* unknown type */` with no width or range derived at all.
  const pairs: ReadonlyArray<readonly [string, JsonSchema, JsonSchema]> = [
    [
      "integer",
      { type: ["integer", "null"] } as JsonSchema,
      nullable({ type: "integer" } as JsonSchema),
    ],
    [
      "string with maxLength",
      { type: ["string", "null"], maxLength: 10 } as JsonSchema,
      nullable({ type: "string", maxLength: 10 } as JsonSchema),
    ],
    [
      "bounded integer",
      { type: ["integer", "null"], minimum: 0, maximum: 100 } as JsonSchema,
      nullable({ type: "integer", minimum: 0, maximum: 100 } as JsonSchema),
    ],
  ];

  it.each(pairs)("%s", (_label, arrayForm, anyOfForm) => {
    const ddl = (schema: JsonSchema) =>
      mapPostgresType(schema, { getNonNullType: getNonNullSchema });

    expect(ddl(arrayForm)).toBe(ddl(anyOfForm));
    expect(varcharWidth(arrayForm)).toBe(varcharWidth(anyOfForm));
    expect(sqlIntegerTypeFor(arrayForm)).toBe(sqlIntegerTypeFor(anyOfForm));
    expect(numericBounds(arrayForm)).toEqual(numericBounds(anyOfForm));
    expect(isNullableSchema(arrayForm)).toBe(true);
  });

  it("a genuine multi-type union stays in the unknown-type branch", () => {
    // Collapsing applies only when ONE non-null type remains. Two real types
    // have no single SQL type, so the honest answer is still the unknown-type
    // branch — not a guess at whichever came first.
    const union = { type: ["string", "integer", "null"] } as JsonSchema;
    expect(mapPostgresType(union, { getNonNullType: getNonNullSchema })).toBe(
      "TEXT /* unknown type */"
    );
    expect(varcharWidth(union)).toBeUndefined();
    expect(sqlIntegerTypeFor(union)).toBeUndefined();

    expect(
      mapPostgresType({ type: ["string", "integer"] } as JsonSchema, {
        getNonNullType: getNonNullSchema,
      })
    ).toBe("TEXT /* unknown type */");
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

describe("sqlIntegerTypeFor agrees with the integer type mapPostgresType emits", () => {
  // Same contract as the VARCHAR matrix: the range enforced on write must be
  // the range of the column the DDL actually declares.
  const cases: JsonSchema[] = [
    { type: "integer" },
    { type: "integer", minimum: 0 },
    { type: "integer", minimum: 0, maximum: 100 },
    { type: "integer", minimum: 0, maximum: 32767 },
    { type: "integer", minimum: 0, maximum: 32768 },
    { type: "integer", minimum: 0, maximum: 2147483647 },
    { type: "integer", minimum: 0, maximum: 2147483648 },
    { type: "integer", minimum: -1, maximum: 9999999999 },
    { type: "integer", minimum: -2147483649 },
    { type: "integer", maximum: 10 },
    { type: "number" },
    { type: "number", multipleOf: 1 },
    { type: "number", multipleOf: 1, minimum: 0, maximum: 5 },
    { type: "number", multipleOf: 0.01 },
    { type: "number", format: "float" },
    { type: "number", format: "double" },
    nullable({ type: "integer", minimum: 0, maximum: 100 }),
    { type: "string" },
  ] as JsonSchema[];

  it.each(cases.map((schema) => [JSON.stringify(schema), schema] as const))(
    "%s",
    (_label, schema) => {
      const sqlType = mapPostgresType(schema, { getNonNullType: getNonNullSchema });
      const selected = sqlIntegerTypeFor(schema);
      const emitted = ["SMALLINT", "INTEGER", "BIGINT"].includes(sqlType) ? sqlType : undefined;

      expect(emitted).toBe(selected);
    }
  );
});

describe("numericBounds", () => {
  it("returns undefined when a column declares no bounds", () => {
    expect(numericBounds({ type: "integer" } as JsonSchema)).toBeUndefined();
  });

  it("returns undefined for non-numeric types", () => {
    expect(numericBounds({ type: "string", maxLength: 5 } as JsonSchema)).toBeUndefined();
  });

  it("reads every bound keyword", () => {
    expect(
      numericBounds({
        type: "number",
        minimum: 1,
        maximum: 10,
        exclusiveMinimum: 0,
        exclusiveMaximum: 11,
      } as JsonSchema)
    ).toEqual({ minimum: 1, maximum: 10, exclusiveMinimum: 0, exclusiveMaximum: 11 });
  });

  it("unwraps a nullable union", () => {
    expect(numericBounds(nullable({ type: "integer", minimum: 3 } as JsonSchema))).toMatchObject({
      minimum: 3,
    });
  });

  it("ignores the draft-04 boolean spelling of exclusiveMinimum", () => {
    // Reading `true` as a bound of 1 would reject every value <= 1.
    expect(
      numericBounds({ type: "integer", exclusiveMinimum: true } as unknown as JsonSchema)
    ).toBeUndefined();
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

  it("drops width, range and bounds in sqlite mode but keeps required and notNull", () => {
    // SQLite emits `TEXT /* VARCHAR(n) */` and a single `INTEGER` type, so it
    // enforces neither width nor column range; schema bounds are emitted as a
    // CHECK by no backend at all. Presence and NOT NULL survive.
    const numericValueSchema = {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 10 },
        score: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["name", "score"],
      additionalProperties: false,
    } as unknown as DataPortSchemaObject;

    const postgres = Object.fromEntries(
      buildColumnConstraints(primaryKeySchema, numericValueSchema, "postgres").map((c) => [
        c.column,
        c,
      ])
    );
    expect(postgres.name.maxLength).toBe(10);
    expect(postgres.score.integerType).toBe("SMALLINT");
    expect(postgres.score.bounds).toEqual({
      minimum: 0,
      maximum: 100,
      exclusiveMinimum: undefined,
      exclusiveMaximum: undefined,
    });

    const sqlite = Object.fromEntries(
      buildColumnConstraints(primaryKeySchema, numericValueSchema, "sqlite").map((c) => [
        c.column,
        c,
      ])
    );
    expect(sqlite.id).toMatchObject({
      isPrimaryKey: true,
      required: true,
      notNull: true,
      maxLength: undefined,
      bounds: undefined,
      integerType: undefined,
    });
    expect(sqlite.name).toMatchObject({
      required: true,
      notNull: true,
      maxLength: undefined,
      bounds: undefined,
      integerType: undefined,
    });
    expect(sqlite.score).toMatchObject({
      required: true,
      notNull: true,
      maxLength: undefined,
      bounds: undefined,
      integerType: undefined,
    });
  });

  it("returns no constraints in off mode", () => {
    expect(buildColumnConstraints(primaryKeySchema, valueSchema, "off")).toEqual([]);
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

describe("integer column range boundaries", () => {
  const constraintsFor = (typeDef: JsonSchema) =>
    buildColumnConstraints(
      {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      } as unknown as DataPortSchemaObject,
      {
        type: "object",
        properties: { n: typeDef },
        required: [],
        additionalProperties: false,
      } as unknown as DataPortSchemaObject
    );

  const check = (typeDef: JsonSchema, n: number) => () =>
    assertColumnConstraints({ id: "a", n }, constraintsFor(typeDef));

  it("has SMALLINT's range fully covered by the bounds that select it", () => {
    // SMALLINT is only chosen when `minimum >= 0` and `maximum <= 32767`, so
    // the declared bounds are necessarily at least as tight as the column's
    // range and always report first. The range check is unreachable here by
    // construction — assert the bound message rather than contriving a schema
    // that cannot exist.
    const smallint = { type: "integer", minimum: 0, maximum: 32767 } as JsonSchema;
    expect(sqlIntegerTypeFor(smallint)).toBe("SMALLINT");
    expect(check(smallint, 32767)).not.toThrow();
    expect(check(smallint, 32768)).toThrow("is above the schema maximum 32767");
    expect(check(smallint, -1)).toThrow("is below the schema minimum 0");
  });

  it("accepts and rejects at INTEGER's edges", () => {
    const int = { type: "integer" } as JsonSchema;
    expect(check(int, 2147483647)).not.toThrow();
    expect(check(int, -2147483648)).not.toThrow();
    expect(check(int, 2147483648)).toThrow("out of range for type integer");
    expect(check(int, -2147483649)).toThrow("out of range for type integer");
  });

  it("rejects exactly 2^63 in a BIGINT column", () => {
    // int8's maximum is 2^63 - 1, which no JS number can hold: the literal
    // rounds up to 2^63. An inclusive `value > max` test would therefore admit
    // 2^63 itself, which Postgres rejects. The bound is stored exclusive to
    // close that gap.
    const bigint = { type: "integer", minimum: 0 } as JsonSchema;
    expect(sqlIntegerTypeFor(bigint)).toBe("BIGINT");
    expect(check(bigint, 2 ** 63)).toThrow("out of range for type bigint");
  });

  it("accepts the largest and smallest values a BIGINT column can really hold", () => {
    // Selected as BIGINT by the maximum alone, so no declared minimum masks
    // the column's lower bound. The declared maximum of 2^63 also lets the
    // range check — not the bound — be what rejects 2^63.
    const bigint = { type: "integer", maximum: 2 ** 63 } as JsonSchema;
    expect(sqlIntegerTypeFor(bigint)).toBe("BIGINT");

    // Doubles near 2^63 are 2048 apart; this is the largest one below it, and
    // it sits comfortably inside int8.
    expect(check(bigint, 2 ** 63 - 2048)).not.toThrow();
    expect(check(bigint, 2 ** 63)).toThrow("out of range for type bigint");

    // -2^63 is int8's exact minimum and is exactly representable.
    expect(check(bigint, -(2 ** 63))).not.toThrow();
    expect(check(bigint, -(2 ** 63) - 4096)).toThrow("out of range for type bigint");
  });
});
