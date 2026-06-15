/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StorageValidationError } from "../tabular/StorageError";

/**
 * Validate that an array-like value has the expected vector dimensionality and
 * that every entry is a finite number. Backed vector stores (pgvector / JSON
 * encoders) only reject malformed inputs after a driver round-trip with an
 * opaque error — fail fast with a clear {@link StorageValidationError} instead.
 *
 * @param arr - The candidate vector (TypedArray, plain array, or any
 *              array-like). `null` / `undefined` are rejected explicitly.
 * @param expectedDimensions - The dimensionality the store was constructed with.
 * @param context - Either `"write"` (insert / upsert) or `"query"`
 *                  (similarity search). The string is woven into the error
 *                  message so logs identify the failing call site.
 */
export function assertVectorShape(
  arr: unknown,
  expectedDimensions: number,
  context: "write" | "query"
): void {
  if (arr === null || arr === undefined) {
    throw new StorageValidationError(
      `Vector value missing on ${context}: expected an array-like of ${expectedDimensions} finite numbers, got ${arr === null ? "null" : "undefined"}.`
    );
  }
  const lengthValue = (arr as { length?: unknown }).length;
  if (typeof lengthValue !== "number") {
    throw new StorageValidationError(
      `Vector value invalid on ${context}: expected an array-like with a numeric length, got ${typeof arr}.`
    );
  }
  if (lengthValue !== expectedDimensions) {
    throw new StorageValidationError(
      `Vector dimension mismatch on ${context}: expected ${expectedDimensions}, got ${lengthValue}.`
    );
  }
  const view = arr as ArrayLike<number>;
  for (let i = 0; i < lengthValue; i++) {
    const v = view[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new StorageValidationError(
        `Vector value invalid on ${context}: entry at index ${i} is not a finite number (got ${String(v)}).`
      );
    }
  }
}

/**
 * Validate the vector column of every entity in a batch before any write hits
 * the backend. Throws the same {@link StorageValidationError} as
 * {@link assertVectorShape}; batches are rejected as a whole — the helper
 * returns on the first malformed entry so no partial write can leak through.
 */
export function validateVectorEntities(
  entities: ReadonlyArray<Record<string, unknown>>,
  vectorPropertyName: string,
  dimensions: number
): void {
  for (const entity of entities) {
    const v = entity[vectorPropertyName];
    if (v === undefined || v === null) {
      throw new StorageValidationError(
        `Vector value missing on write: expected an array-like of ${dimensions} finite numbers, got ${v === null ? "null" : "undefined"}.`
      );
    }
    assertVectorShape(v, dimensions, "write");
  }
}
