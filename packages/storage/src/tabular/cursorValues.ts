/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StorageValidationError } from "./StorageError";

/**
 * Converts a row column value into a JSON-serialisable form for cursor
 * encoding, and is also used by the in-memory comparator so that row
 * values and decoded cursor values are normalised the same way before
 * comparison. Returning `string | number | boolean | null` keeps the
 * comparison space simple (lexicographic on strings, numeric on numbers).
 *
 * - `Date` becomes its ISO 8601 string. ISO 8601 sorts chronologically
 *   under lexicographic comparison, which is the property we rely on to
 *   compare a row's `Date` against a cursor's encoded date string.
 * - `bigint` is rejected. JS `bigint > bigint` works numerically, but
 *   once a bigint is encoded into the cursor as a decimal string, naive
 *   string comparison no longer matches the numeric order (`"10" < "9"`).
 *   Mixing the two in the in-memory comparator would silently mis-order
 *   pages. Until the cursor format carries explicit type information,
 *   keyset paging on a bigint column is unsupported — fail loudly so
 *   callers either change the column type or override `getPage`.
 * - `Uint8Array` and other object types are not orderable as cursor keys.
 */
export function toCursorValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  // Use `StorageValidationError` (not generic `Error`) so the failure
  // mode for an unsupported key type matches the rest of the cursor
  // codec — `decodeCursor` already throws the same class for malformed
  // input, and downstream callers translating cursor failures into 4xx
  // responses can catch one consistent type instead of an unclassified
  // 500.
  if (typeof value === "bigint") {
    throw new StorageValidationError(
      "bigint values are not supported as cursor keys — string-encoded bigints don't sort numerically. Use a number column or override `getPage` for this storage."
    );
  }
  throw new StorageValidationError(
    `Cannot encode value of type ${typeof value} into a pagination cursor; use a key column with a primitive type.`
  );
}

/**
 * Compares two cursor key values, normalising each side through
 * {@link toCursorValue} first so a row's runtime value (which may be a
 * `Date` or other rich type) is comparable against a cursor's decoded
 * primitive. Nulls sort before non-nulls, then standard `<`/`>`. Booleans
 * are coerced to numbers (`false` < `true`) so the sort and the keyset
 * filter can never disagree on boolean ordering. Returns -1, 0, or 1.
 */
export function compareKeyValues(a: unknown, b: unknown): number {
  const an = toCursorValue(a);
  const bn = toCursorValue(b);
  if (an === null && bn === null) return 0;
  if (an === null) return -1;
  if (bn === null) return 1;
  const av = typeof an === "boolean" ? Number(an) : an;
  const bv = typeof bn === "boolean" ? Number(bn) : bn;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}
