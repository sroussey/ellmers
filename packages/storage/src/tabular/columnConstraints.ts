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

/** Extracts the non-null branch from a `T | null` union schema. */
export function getNonNullSchema(typeDef: JsonSchema): JsonSchema {
  if (typeof typeDef === "boolean") return typeDef;

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
  }
}
