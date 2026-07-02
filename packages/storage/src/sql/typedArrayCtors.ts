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
 *
 * `Float16Array` is included to match the documented quantized-vector set. On
 * runtimes that predate native `Float16Array`, `@workglow/util`'s schema layer
 * installs a `globalThis.Float16Array` polyfill at module-load time, so the
 * reference here resolves whenever a vector column was actually stored as
 * Float16. The entry is registered conditionally so loading this module before
 * the polyfill (or on a runtime that genuinely lacks it) cannot throw a
 * `ReferenceError`.
 */
export const TYPED_ARRAY_CTORS: Record<string, new (data: number[]) => ArrayBufferView> = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
  ...(typeof globalThis.Float16Array !== "undefined"
    ? { Float16Array: globalThis.Float16Array as new (data: number[]) => ArrayBufferView }
    : {}),
};
