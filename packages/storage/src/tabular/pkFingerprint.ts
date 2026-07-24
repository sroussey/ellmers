/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stable, collision-resistant fingerprint over an ordered tuple of primary-key
 * values. Used by SQL backends to match rows across a `putBulk` input list and
 * the database's `RETURNING *` response, and to dedupe last-wins when the same
 * primary key is submitted multiple times in one batch.
 *
 * `JSON.stringify` alone silently drops `bigint` values (throws in strict mode
 * on some runtimes) and stringifies `Uint8Array` as the ordered object of its
 * indices — either mode gives two different `123n` and `"123"` primary keys
 * the same fingerprint (`"[null]"` for both), which then collapses distinct
 * rows in `runBulkPut`'s dedupe map or misaligns the response. A typed wrapper
 * around the affected values keeps fingerprints byte-identical to today for
 * every other primary-key value type (number / string / boolean / null /
 * plain-object / array), while giving `bigint` and `Uint8Array` unambiguous
 * encodings that cannot collide with those.
 */
export function pkFingerprint(values: readonly unknown[]): string {
  return JSON.stringify(values, pkReplacer);
}

function pkReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return { __t: "n", v: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return { __t: "u8", v: bytesToHex(value) };
  }
  return value;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}
