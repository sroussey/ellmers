/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";
import type { KeyGenerationStrategy } from "./BaseTabularStorage";

/** The primary-key / value halves a tabular schema is split into at construction. */
export interface SplitTabularSchema {
  readonly primaryKeySchema: DataPortSchemaObject;
  readonly valueSchema: DataPortSchemaObject;
}

/**
 * Splits a table schema into its primary-key half and its value half,
 * carrying each side's `required` list across. Property definitions are
 * shallow-copied so neither half aliases the source schema.
 */
export function splitSchemaByPrimaryKey(
  schema: DataPortSchemaObject,
  primaryKeyNames: readonly PropertyKey[]
): SplitTabularSchema {
  const primaryKeyProps: Record<string, any> = {};
  const valueProps: Record<string, any> = {};
  const primaryKeySet = new Set<PropertyKey>(primaryKeyNames);

  for (const [key, typeDef] of Object.entries(schema.properties)) {
    if (primaryKeySet.has(key)) {
      primaryKeyProps[key] = Object.assign({}, typeDef);
    } else {
      valueProps[key] = Object.assign({}, typeDef);
    }
  }

  const primaryKeyRequired = schema.required?.filter((key) => primaryKeySet.has(key)) ?? [];
  const valueRequired = schema.required?.filter((key) => !primaryKeySet.has(key)) ?? [];

  return {
    primaryKeySchema: {
      type: "object",
      properties: primaryKeyProps,
      required: primaryKeyRequired,
      additionalProperties: false,
    } as DataPortSchemaObject,
    valueSchema: {
      type: "object",
      properties: valueProps,
      required: valueRequired,
      additionalProperties: false,
    } as DataPortSchemaObject,
  };
}

/**
 * Rejects column names that are not identifier-shaped. Concrete backends
 * interpolate these into DDL and SQL, so anything outside
 * `[A-Za-z][A-Za-z0-9_]*` is refused at construction rather than at query time.
 */
export function assertValidColumnNames(columns: readonly unknown[]): void {
  for (const column of columns) {
    if (typeof column !== "string") {
      throw new Error("Column names must be strings");
    }
    if (!/^[a-z]\w*$/i.test(column)) {
      throw new Error(
        "Column names must start with a letter and contain only letters, digits, and underscores"
      );
    }
  }
}

/** Normalises the constructor's index argument into a list of column tuples. */
export function toIndexTuples<Entity>(
  indexes: readonly (keyof Entity | readonly (keyof Entity)[])[]
): Array<Array<keyof Entity>> {
  return indexes.map((spec) => (Array.isArray(spec) ? spec : [spec])) as Array<Array<keyof Entity>>;
}

/**
 * Drops any compound index that is a prefix of another compound index or of
 * the primary key — it's redundant for lookups. Single-column indexes are
 * always kept even when prefix-redundant: a dedicated narrow index can still
 * be a deliberate optimization over a wider tuple's leftmost-prefix scan.
 *
 * Sorts `potentialKeys` in place by length, as the original did.
 */
export function filterCompoundKeys<Entity>(
  primaryKey: Array<keyof Entity>,
  potentialKeys: Array<keyof Entity>[]
): Array<keyof Entity>[] {
  const isPrefix = (prefix: Array<keyof Entity>, arr: Array<keyof Entity>): boolean => {
    if (prefix.length > arr.length) return false;
    return prefix.every((val, index) => val === arr[index]);
  };

  potentialKeys.sort((a, b) => a.length - b.length);

  let filteredKeys: Array<keyof Entity>[] = [];

  for (let i = 0; i < potentialKeys.length; i++) {
    let key = potentialKeys[i];

    if (isPrefix(key, primaryKey)) continue;

    // Always keep single-column indexes even if they'd be prefix-redundant.
    if (key.length === 1) {
      filteredKeys.push(key);
      continue;
    }

    let isRedundant = potentialKeys.some((otherKey, j) => j > i && isPrefix(key, otherKey));

    if (!isRedundant) {
      filteredKeys.push(key);
    }
  }

  return filteredKeys;
}

/** Every searchable-index column must exist in one of the two schema halves. */
export function assertIndexColumnsInSchema<Entity>(
  indexes: ReadonlyArray<ReadonlyArray<keyof Entity>>,
  primaryKeySchema: DataPortSchemaObject,
  valueSchema: DataPortSchemaObject
): void {
  for (const compoundIndex of indexes) {
    for (const column of compoundIndex) {
      if (!(column in primaryKeySchema.properties) && !(column in valueSchema.properties)) {
        throw new Error(
          `Searchable column ${String(column)} is not in the primary key schema or value schema`
        );
      }
    }
  }
}

/**
 * Copies and validates the declared unique-index tuples. NULL semantics and
 * DDL emission live in the concrete backends; this only checks that each
 * tuple is non-empty and names real columns.
 */
export function normalizeUniqueIndexes<Entity>(
  uniqueIndexes: readonly (readonly (keyof Entity)[])[],
  primaryKeySchema: DataPortSchemaObject,
  valueSchema: DataPortSchemaObject
): Array<Array<keyof Entity>> {
  const normalized = uniqueIndexes.map((spec) => [...spec]) as Array<Array<keyof Entity>>;
  for (const uniqueIndex of normalized) {
    if (uniqueIndex.length === 0) {
      throw new Error("Unique index column list must not be empty");
    }
    for (const column of uniqueIndex) {
      if (!(column in primaryKeySchema.properties) && !(column in valueSchema.properties)) {
        throw new Error(
          `Unique-index column ${String(column)} is not in the primary key schema or value schema`
        );
      }
    }
  }
  return normalized;
}

/**
 * Drops any regular index whose column tuple exactly matches a declared
 * unique index — a UNIQUE index is also a B-tree on the same columns in
 * the same order, so the non-unique copy is pure waste (duplicate disk +
 * duplicate write on every row). Prefix relationships are intentionally
 * NOT collapsed here: the existing single-column carve-out in
 * {@link filterCompoundKeys} reflects that a dedicated narrow index can still
 * be a deliberate optimization vs a wider unique tuple's leftmost-prefix scan.
 *
 * Tuples are keyed on a NUL-joined string because NUL cannot appear in a
 * validated column name, so no two distinct tuples can collide.
 */
export function dropIndexesCoveredByUnique<Entity>(
  indexes: Array<Array<keyof Entity>>,
  uniqueIndexes: ReadonlyArray<ReadonlyArray<keyof Entity>>
): Array<Array<keyof Entity>> {
  const uniqueTupleKeys = new Set(uniqueIndexes.map((tuple) => tuple.map(String).join("\u0000")));
  return indexes.filter((tuple) => !uniqueTupleKeys.has(tuple.map(String).join("\u0000")));
}

/**
 * Returns the single primary-key column marked `x-auto-generated: true`, or
 * `null` when there is none. Any position in a composite key is allowed —
 * composite keys often put a scope column first (e.g. `kb_id`) and
 * auto-generate a second id — but at most one column may be auto-generated.
 */
export function detectAutoGeneratedKey(
  schema: DataPortSchemaObject,
  primaryKeyNames: readonly PropertyKey[]
): string | null {
  const autoGeneratedKeys: string[] = [];
  for (const key of primaryKeyNames) {
    const keyStr = String(key);
    const propDef = (schema.properties as any)[keyStr];
    if (propDef && typeof propDef === "object" && "x-auto-generated" in propDef) {
      if (propDef["x-auto-generated"] === true) {
        autoGeneratedKeys.push(keyStr);
      }
    }
  }

  if (autoGeneratedKeys.length > 1) {
    throw new Error(
      `Multiple auto-generated keys detected: ${autoGeneratedKeys.join(", ")}. ` +
        `At most one primary key column can be auto-generated.`
    );
  }

  return autoGeneratedKeys.length > 0 ? autoGeneratedKeys[0] : null;
}

/**
 * Picks the key-generation strategy for an auto-generated column: integer
 * columns autoincrement, everything else gets a UUID.
 */
export function determineGenerationStrategy(
  _columnName: string,
  typeDef: any
): KeyGenerationStrategy {
  // Peel a `null` branch off of an anyOf/oneOf so a `string | null` PK column
  // still picks the "string" strategy.
  let actualType = typeDef;
  if (typeDef && typeof typeDef === "object") {
    if (typeDef.anyOf && Array.isArray(typeDef.anyOf)) {
      actualType = typeDef.anyOf.find((t: any) => t.type !== "null") || typeDef;
    } else if (typeDef.oneOf && Array.isArray(typeDef.oneOf)) {
      actualType = typeDef.oneOf.find((t: any) => t.type !== "null") || typeDef;
    }
  }

  if (typeof actualType !== "object") {
    return "uuid";
  }

  if (actualType.type === "integer") {
    return "autoincrement";
  }

  return "uuid";
}
