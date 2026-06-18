/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maps a TypedArray constructor name (as recorded in a vector column's schema)
 * back to its constructor, used when decoding stored vector bytes into a typed
 * array. Shared by the SQL tabular backends so the supported set stays
 * consistent across SQLite and Postgres.
 */
export const TYPED_ARRAY_CTORS: Record<string, new (data: number[]) => ArrayBufferView> = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
};
