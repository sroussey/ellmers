/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject, JsonSchema } from "@workglow/util/schema";
import { StorageValidationError } from "./StorageError";

/**
 * VARCHAR widths the SQL backends derive from a string `format` rather than
 * from `maxLength`. Kept here (rather than inline in the Postgres type map) so
 * the schemaless backends can enforce exactly the width the DDL declares.
 */
const FORMAT_VARCHAR_WIDTHS: Readonly<Record<string, number>> = {
  email: 255,
  uri: 2048,
};

/**
 * String formats that map to a dedicated column type (TIMESTAMP / DATE /
 * UUID), so a `maxLength` alongside them never becomes a VARCHAR width.
 */
const NON_VARCHAR_STRING_FORMATS: ReadonlySet<string> = new Set(["date-time", "date", "uuid"]);

/**
 * The VARCHAR width implied by a string `format` alone, ignoring `maxLength`.
 * `mapPostgresType` reads this when emitting DDL so a format's width is
 * declared in exactly one place.
 */
export function varcharWidthForFormat(format: unknown): number | undefined {
  return typeof format === "string" ? FORMAT_VARCHAR_WIDTHS[format] : undefined;
}

/** The integer column types the SQL backends select between. */
export type SqlIntegerType = "SMALLINT" | "INTEGER" | "BIGINT";

/**
 * Value range of each integer column type: `min` inclusive, `maxExclusive`
 * exclusive. A value outside it is a hard error on the DB ("smallint out of
 * range"), independent of whatever the schema's own `minimum`/`maximum` say.
 *
 * The upper bound is stored *exclusive* so every bound here is a power of two
 * and therefore exactly representable as a double. Spelling int8's inclusive
 * maximum instead would be a lie: `9223372036854775807` rounds up to 2^63 as a
 * JS number, so a `value > max` test would admit exactly 2^63 — a value
 * Postgres rejects. Comparing `value >= 2^63` has no such gap, and the same
 * form works unchanged for the two narrower types.
 */
const SQL_INTEGER_RANGES: Readonly<Record<SqlIntegerType, { min: number; maxExclusive: number }>> =
  {
    SMALLINT: { min: -32768, maxExclusive: 32768 },
    INTEGER: { min: -2147483648, maxExclusive: 2147483648 },
    // -2^63 is exactly representable, so the lower bound stays inclusive.
    BIGINT: { min: -9223372036854775808, maxExclusive: 9223372036854775808 },
  };

/**
 * The integer column type a schema maps to, or `undefined` when the column is
 * not integral (a float/NUMERIC column, or not a number at all).
 *
 * This is the single source of truth for the selection: `mapPostgresType` reads
 * it when emitting DDL, and {@link buildColumnConstraints} reads it so the
 * schemaless backends reject exactly the overflows Postgres would.
 */
export function sqlIntegerTypeFor(typeDef: JsonSchema): SqlIntegerType | undefined {
  const actualType = getNonNullSchema(typeDef);
  if (typeof actualType === "boolean") return undefined;
  if (actualType.type !== "number" && actualType.type !== "integer") return undefined;
  // `multipleOf: 1` marks a `number` schema as integral, same as `type: integer`.
  if (actualType.multipleOf !== 1 && actualType.type !== "integer") return undefined;

  if (typeof actualType.minimum === "number" && actualType.minimum >= 0) {
    // Unsigned: pick the narrowest type that holds the declared maximum.
    if (typeof actualType.maximum === "number") {
      if (actualType.maximum <= 32767) return "SMALLINT";
      if (actualType.maximum <= 2147483647) return "INTEGER";
    }
    return "BIGINT";
  }

  // Signed (or unbounded-below): widen to BIGINT when either bound escapes
  // INTEGER's range.
  if (typeof actualType.maximum === "number" && actualType.maximum > 2147483647) return "BIGINT";
  if (typeof actualType.minimum === "number" && actualType.minimum < -2147483648) return "BIGINT";
  return "INTEGER";
}

/** Numeric bounds a schema declares on a `number`/`integer` column. */
export interface NumericBounds {
  readonly minimum: number | undefined;
  readonly maximum: number | undefined;
  readonly exclusiveMinimum: number | undefined;
  readonly exclusiveMaximum: number | undefined;
}

/**
 * The numeric bounds declared on a column, or `undefined` when it declares
 * none. Only the numeric (draft-06+) spelling of `exclusiveMinimum` /
 * `exclusiveMaximum` is read; the legacy draft-04 boolean form is ignored
 * rather than misread as a bound of `0`/`1`.
 */
export function numericBounds(typeDef: JsonSchema): NumericBounds | undefined {
  const actualType = getNonNullSchema(typeDef);
  if (typeof actualType === "boolean") return undefined;
  if (actualType.type !== "number" && actualType.type !== "integer") return undefined;

  const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;

  const bounds: NumericBounds = {
    minimum: asNumber(actualType.minimum),
    maximum: asNumber(actualType.maximum),
    exclusiveMinimum: asNumber(actualType.exclusiveMinimum),
    exclusiveMaximum: asNumber(actualType.exclusiveMaximum),
  };

  const declaresSomething = Object.values(bounds).some((bound) => bound !== undefined);
  return declaresSomething ? bounds : undefined;
}

/** Whether a JSON Schema property admits `null`. */
export function isNullableSchema(typeDef: JsonSchema): boolean {
  if (typeof typeDef === "boolean") return typeDef;

  if (typeDef.type === "null") {
    return true;
  }

  if (Array.isArray(typeDef.type)) {
    return typeDef.type.includes("null");
  }

  if (typeDef.anyOf && Array.isArray(typeDef.anyOf)) {
    return typeDef.anyOf.some((type: any) => type.type === "null");
  }

  if (typeDef.oneOf && Array.isArray(typeDef.oneOf)) {
    return typeDef.oneOf.some((type: any) => type.type === "null");
  }

  return false;
}

/**
 * Extracts the non-null branch from a `T | null` union schema, in either
 * spelling: `anyOf`/`oneOf`, or the `type: ["string", "null"]` array form.
 *
 * The array form matters as much as the others — `RunUsageSchema` and friends
 * use it — and it was previously left intact, so every caller switching on
 * `type` saw an array rather than `"string"`/`"integer"` and fell through to
 * its unknown-type branch. That made `mapPostgresType` emit
 * `TEXT /* unknown type *\/` for what should be an INTEGER column, and left
 * such columns with no derived width or range at all.
 */
export function getNonNullSchema(typeDef: JsonSchema): JsonSchema {
  if (typeof typeDef === "boolean") return typeDef;

  if (Array.isArray(typeDef.type)) {
    const nonNullTypes = typeDef.type.filter((entry) => entry !== "null");
    // Collapse to the concrete type only when exactly one remains. A genuine
    // multi-type union stays an array and keeps falling through to the
    // callers' unknown-type handling, which is the honest answer for a column
    // that has no single SQL type.
    if (nonNullTypes.length === 1) {
      return { ...typeDef, type: nonNullTypes[0] } as JsonSchema;
    }
    return typeDef;
  }

  if (typeDef.anyOf && Array.isArray(typeDef.anyOf)) {
    const nonNullType = typeDef.anyOf.find((t: any) => t.type !== "null");
    if (nonNullType) {
      return nonNullType;
    }
  }
  if (typeDef.oneOf && Array.isArray(typeDef.oneOf)) {
    const nonNullType = typeDef.oneOf.find((t: any) => t.type !== "null");
    if (nonNullType) {
      return nonNullType;
    }
  }
  return typeDef;
}

/**
 * The VARCHAR width a column declares, or `undefined` when the column is not a
 * width-bounded character column (TEXT, BYTEA, or any non-string type).
 *
 * This is the single source of truth for the width: `mapPostgresType` reads it
 * when emitting `VARCHAR(n)` DDL, and {@link buildColumnConstraints} reads it
 * so the schemaless backends reject exactly the values Postgres would.
 */
export function varcharWidth(typeDef: JsonSchema): number | undefined {
  const actualType = getNonNullSchema(typeDef);
  if (typeof actualType === "boolean") return undefined;
  if (actualType.type !== "string") return undefined;
  // A blob column stores bytes (BYTEA) — a `maxLength` on it is not a
  // character width on any backend.
  if (actualType.contentEncoding === "blob") return undefined;

  const formatWidth = varcharWidthForFormat(actualType.format);
  if (formatWidth !== undefined) return formatWidth;
  if (typeof actualType.format === "string" && NON_VARCHAR_STRING_FORMATS.has(actualType.format)) {
    return undefined;
  }

  return typeof actualType.maxLength === "number" ? actualType.maxLength : undefined;
}

/** The write-time constraints a single column imposes on every stored row. */
export interface TabularColumnConstraint {
  readonly column: string;
  /** Primary-key columns are NOT NULL regardless of the schema's `required`. */
  readonly isPrimaryKey: boolean;
  /** The column must be present on every written row. */
  readonly required: boolean;
  /** The column rejects an explicit `null`. */
  readonly notNull: boolean;
  /** Declared VARCHAR width, when the column maps to a width-bounded column. */
  readonly maxLength: number | undefined;
  /** Declared numeric bounds, when the column is a number and declares any. */
  readonly bounds: NumericBounds | undefined;
  /** Integer column type the DDL selects, when the column is integral. */
  readonly integerType: SqlIntegerType | undefined;
}

/**
 * Derives the per-column write constraints implied by a storage's schema,
 * mirroring the DDL the SQL backends emit:
 *
 * - Primary-key columns are `NOT NULL` (see `constructPrimaryKeyColumns`).
 * - A value column is `NOT NULL` when it is listed in `required` *and* its
 *   type does not admit null (see `constructValueColumns`).
 * - A `required` column must also be *present*, which is what the SQL backends
 *   enforce client-side in `getValueAsOrderedArray` /
 *   `getPrimaryKeyAsOrderedArray` before a statement is ever built.
 * - A string column carrying a width maps to `VARCHAR(n)`.
 * - An integral column maps to `SMALLINT`/`INTEGER`/`BIGINT`, whose range the
 *   database enforces.
 *
 * It also carries the schema's declared numeric bounds. Those are the one
 * constraint here the SQL backends do *not* fully emit — they add
 * `CHECK (col >= 0)` for an unsigned column but nothing for the bounds
 * themselves — so enforcing them is deliberately stricter than the database.
 * See {@link assertNumericConstraints}.
 *
 * Computed once per storage instance; the result is a plain array so the
 * per-write check is a straight loop with no schema walking.
 */
export function buildColumnConstraints(
  primaryKeySchema: DataPortSchemaObject,
  valueSchema: DataPortSchemaObject
): ReadonlyArray<TabularColumnConstraint> {
  const constraints: TabularColumnConstraint[] = [];

  for (const [column, typeDef] of Object.entries(primaryKeySchema.properties)) {
    constraints.push({
      column,
      isPrimaryKey: true,
      required: true,
      notNull: true,
      maxLength: varcharWidth(typeDef),
      bounds: numericBounds(typeDef),
      integerType: sqlIntegerTypeFor(typeDef),
    });
  }

  const requiredValues = new Set<string>(valueSchema.required ?? []);
  for (const [column, typeDef] of Object.entries(valueSchema.properties)) {
    const required = requiredValues.has(column);
    constraints.push({
      column,
      isPrimaryKey: false,
      required,
      notNull: required && !isNullableSchema(typeDef),
      maxLength: varcharWidth(typeDef),
      bounds: numericBounds(typeDef),
      integerType: sqlIntegerTypeFor(typeDef),
    });
  }

  return constraints;
}

/**
 * Counts Unicode characters (code points), which is the unit Postgres uses for
 * `VARCHAR(n)`. JavaScript's `String.length` counts UTF-16 code units, so an
 * astral character (emoji, rarer CJK) would otherwise count double and reject
 * a value the database accepts.
 */
function characterLength(value: string): number {
  let count = 0;
  for (const _character of value) count++;
  return count;
}

/**
 * Whether `value` is wider than `width` characters. Code units are never fewer
 * than code points, so a string that fits by `.length` fits outright — only the
 * strings that fail the cheap test pay for the code-point walk.
 */
function exceedsWidth(value: string, width: number): boolean {
  if (value.length <= width) return false;
  return characterLength(value) > width;
}

/**
 * Throws when `value` violates the numeric constraints on `constraint`.
 *
 * Two distinct sources are checked, and the messages say which is which:
 *
 * - **Schema bounds** (`minimum`/`maximum`/`exclusive*`). The SQL backends emit
 *   a `CHECK (col >= 0)` for an unsigned column but no CHECK for the bounds
 *   themselves, so enforcing these makes the schemaless backends *stricter*
 *   than the database. That is deliberate: the schema is the declared contract
 *   for every backend, and a value outside it is a bug wherever it is stored.
 * - **Integer column range**, which the database really does reject.
 */
function assertNumericConstraints(value: number, constraint: TabularColumnConstraint): void {
  const bounds = constraint.bounds;
  if (bounds) {
    // NaN fails no comparison below; the integer check catches it for integral
    // columns, and Postgres accepts NaN in float/NUMERIC columns anyway.
    if (bounds.minimum !== undefined && value < bounds.minimum) {
      throw new StorageValidationError(
        `value ${value} for column "${constraint.column}" is below the schema minimum ${bounds.minimum}`
      );
    }
    if (bounds.maximum !== undefined && value > bounds.maximum) {
      throw new StorageValidationError(
        `value ${value} for column "${constraint.column}" is above the schema maximum ${bounds.maximum}`
      );
    }
    if (bounds.exclusiveMinimum !== undefined && value <= bounds.exclusiveMinimum) {
      throw new StorageValidationError(
        `value ${value} for column "${constraint.column}" is not above the schema ` +
          `exclusiveMinimum ${bounds.exclusiveMinimum}`
      );
    }
    if (bounds.exclusiveMaximum !== undefined && value >= bounds.exclusiveMaximum) {
      throw new StorageValidationError(
        `value ${value} for column "${constraint.column}" is not below the schema ` +
          `exclusiveMaximum ${bounds.exclusiveMaximum}`
      );
    }
  }

  const integerType = constraint.integerType;
  if (integerType) {
    if (!Number.isInteger(value)) {
      throw new StorageValidationError(
        `column "${constraint.column}" is ${integerType} but got a non-integer value: ${value}`
      );
    }
    const range = SQL_INTEGER_RANGES[integerType];
    if (value < range.min || value >= range.maxExclusive) {
      throw new StorageValidationError(
        `value ${value} is out of range for type ${integerType.toLowerCase()}: ` +
          `column "${constraint.column}"`
      );
    }
  }
}

/**
 * Throws when `row` violates any of `constraints`. Lets the schemaless
 * backends (InMemory and the storages layered on it) fail on a row that a
 * SQL backend would have rejected, instead of silently accepting a missing
 * `NOT NULL` column or an over-long `VARCHAR` and only failing in production.
 *
 * Error messages deliberately echo the SQL backends' wording so a test that
 * asserts on the message reads the same across backends.
 */
export function assertColumnConstraints(
  row: Record<string, unknown>,
  constraints: ReadonlyArray<TabularColumnConstraint>
): void {
  for (const constraint of constraints) {
    const value = row[constraint.column];

    // An absent column and an explicit `undefined` are the same thing to every
    // backend: there is no value to bind, so a required column has nothing to
    // store.
    if (value === undefined) {
      if (constraint.required) {
        throw new StorageValidationError(
          constraint.isPrimaryKey
            ? `Missing required primary key field: ${constraint.column}`
            : `Missing required value field: ${constraint.column}`
        );
      }
      continue;
    }

    if (value === null) {
      if (constraint.notNull) {
        throw new StorageValidationError(
          constraint.isPrimaryKey
            ? `Primary key field ${constraint.column} cannot be null`
            : `NOT NULL constraint failed: ${constraint.column}`
        );
      }
      continue;
    }

    if (
      constraint.maxLength !== undefined &&
      typeof value === "string" &&
      exceedsWidth(value, constraint.maxLength)
    ) {
      throw new StorageValidationError(
        `value too long for type character varying(${constraint.maxLength}): ` +
          `column "${constraint.column}" is ${characterLength(value)} characters`
      );
    }

    if (typeof value === "number") {
      assertNumericConstraints(value, constraint);
    }
  }
}
