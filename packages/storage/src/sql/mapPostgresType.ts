/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/schema";
import { varcharWidthForFormat } from "../tabular/columnConstraints";

/** Options for {@link mapPostgresType}. */
export interface PostgresTypeMapOptions {
  /**
   * Resolve the non-null variant of a (possibly `anyOf`-nullable) schema.
   * Supplied by the storage class so the JSON-Schema → SQL mapping reuses the
   * same null-stripping logic as the rest of the backend.
   */
  readonly getNonNullType: (typeDef: JsonSchema) => JsonSchema;
  /**
   * Optional hook for the pgvector extension: given the resolved non-null
   * type of a `string` column, return a `vector(N)` column type, or undefined
   * to fall through to the normal string handling. Backends without pgvector
   * (e.g. Supabase via PostgREST) omit this.
   */
  readonly vectorTypeFor?: (actualType: Exclude<JsonSchema, boolean>) => string | undefined;
}

/**
 * Map a JSON Schema property to a PostgreSQL column type. Shared by every
 * Postgres-shaped backend so the type mapping (string formats, integer range
 * selection, NUMERIC precision, native array support, JSONB fallbacks) lives
 * in one place. The only backend-specific behavior — pgvector columns — is
 * injected via {@link PostgresTypeMapOptions.vectorTypeFor}.
 */
export function mapPostgresType(typeDef: JsonSchema, options: PostgresTypeMapOptions): string {
  const actualType = options.getNonNullType(typeDef);
  if (typeof actualType === "boolean") {
    return "TEXT /* boolean schema */";
  }

  // Handle BLOB type
  if (actualType.contentEncoding === "blob") return "BYTEA";

  switch (actualType.type) {
    case "string": {
      // Handle special string formats that map to a dedicated column type
      if (actualType.format === "date-time") return "TIMESTAMP";
      if (actualType.format === "date") return "DATE";
      if (actualType.format === "uuid") return "UUID";

      // Formats carrying an implied width (`email`, `uri`) resolve before the
      // pgvector hook. Read from the shared table so the width this DDL
      // declares is the width `varcharWidth` reports to the schemaless
      // backends — the two cannot drift apart.
      const formatWidth = varcharWidthForFormat(actualType.format);
      if (formatWidth !== undefined) return `VARCHAR(${formatWidth})`;

      // Backend-specific vector column (pgvector), when supported.
      const vectorType = options.vectorTypeFor?.(actualType);
      if (vectorType) return vectorType;

      // Use a VARCHAR with maxLength if specified
      if (typeof actualType.maxLength === "number") {
        return `VARCHAR(${actualType.maxLength})`;
      }

      // Default to TEXT for strings without constraints
      return "TEXT";
    }

    case "number":
    case "integer":
      // Handle integer vs floating point
      if (actualType.multipleOf === 1 || actualType.type === "integer") {
        // Use PostgreSQL's numeric range types based on min/max values.
        if (typeof actualType.minimum === "number" && actualType.minimum >= 0) {
          // For unsigned integers.
          if (typeof actualType.maximum === "number") {
            if (actualType.maximum <= 32767) return "SMALLINT";
            if (actualType.maximum <= 2147483647) return "INTEGER";
          }
          return "BIGINT";
        }

        // Signed (or unbounded-below) integers: a large positive maximum still
        // needs a wide enough column. Without this, a schema like
        // `{ type: "integer", minimum: -1, maximum: 9999999999 }` would map to
        // INTEGER (max 2147483647) and reject schema-valid writes at runtime.
        // A minimum below INTEGER's lower bound also forces BIGINT.
        if (typeof actualType.maximum === "number" && actualType.maximum > 2147483647) {
          return "BIGINT";
        }
        if (typeof actualType.minimum === "number" && actualType.minimum < -2147483648) {
          return "BIGINT";
        }

        // Default integer type.
        return "INTEGER";
      }

      // For floating point numbers with precision requirements
      if (actualType.format === "float") return "REAL";
      if (actualType.format === "double") return "DOUBLE PRECISION";

      // Use NUMERIC with precision/scale if specified
      if (typeof actualType.multipleOf === "number") {
        const decimalPlaces = String(actualType.multipleOf).split(".")[1]?.length || 0;
        if (decimalPlaces > 0) {
          return `NUMERIC(38, ${decimalPlaces})`;
        }
      }

      return "NUMERIC";

    case "boolean":
      return "BOOLEAN";

    case "array":
      // Handle array types (if items type is specified)
      if (
        actualType.items &&
        typeof actualType.items === "object" &&
        !Array.isArray(actualType.items)
      ) {
        const itemType = mapPostgresType(actualType.items as JsonSchema, options);

        // Only use native PostgreSQL arrays for simple scalar types.
        const supportedArrayElementTypes = [
          "TEXT",
          "VARCHAR",
          "CHAR",
          "INTEGER",
          "SMALLINT",
          "BIGINT",
          "REAL",
          "DOUBLE PRECISION",
          "NUMERIC",
          "BOOLEAN",
          "UUID",
          "DATE",
          "TIMESTAMP",
        ];

        // Match exactly, or by prefix for parameterized types like VARCHAR(255).
        const isSupported = supportedArrayElementTypes.some(
          (type) => itemType === type || (itemType.startsWith(type + "(") && type !== "VARCHAR")
        );

        if (isSupported) {
          return `${itemType}[]`;
        } else {
          return "JSONB /* complex array */";
        }
      }
      return "JSONB /* generic array */";

    case "object":
      return "JSONB /* object */";

    default:
      return "TEXT /* unknown type */";
  }
}
