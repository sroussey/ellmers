/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StorageValidationError } from "./StorageError";

/**
 * Opaque cursor token returned by paginated queries.
 *
 * Encodes the position of the last seen row so the next page can resume
 * from there using keyset (a.k.a. seek) pagination. Callers must treat
 * cursors as opaque — the encoding is an implementation detail.
 */
export type Cursor = string & { readonly __cursorBrand: unique symbol };

/**
 * Internal cursor payload.
 *
 * - `v` is a format version (currently 1) so older cursors can be rejected
 *   if the encoding ever changes.
 * - `n` (names) and `c` (column values) are parallel arrays describing
 *   the effective ordering of the row the cursor is parked on:
 *   caller-supplied `orderBy` columns first, then any primary-key columns
 *   not already covered by `orderBy` as a tiebreaker. The flat layout
 *   means columns that appear in both the user's `orderBy` and the
 *   primary key are stored exactly once (avoids double-encoding the
 *   value in DESC-by-PK pagination). Storing column names lets us
 *   detect cursors handed back from a different orderBy shape — pure
 *   arity matching can't catch swaps between same-arity orderings.
 */
export interface CursorPayload {
  readonly v: 1;
  readonly n: ReadonlyArray<string>;
  readonly c: ReadonlyArray<string | number | boolean | null>;
}

/** Cursor format version recognised by this build. */
export const CURSOR_VERSION = 1 as const;

/**
 * Maximum accepted cursor length, in characters of the encoded form.
 * Real cursors are well under 1 KB (a few primary-key values plus an
 * orderBy worth of column names); the cap exists so a hostile client
 * can't force the server to base64-decode and JSON-parse arbitrarily
 * large strings, which would be cheap memory/CPU abuse.
 */
export const MAX_CURSOR_LENGTH = 8 * 1024;

/**
 * Encodes a cursor payload as an opaque, URL-safe string.
 *
 * The transport is base64url(JSON(payload)). The format is intentionally
 * not documented for callers — it's an implementation detail and may be
 * tightened in future versions (signed, length-limited, etc.).
 */
export function encodeCursor(payload: CursorPayload): Cursor {
  if (payload.n.length !== payload.c.length) {
    throw new Error(
      `Cursor names/values arity mismatch: ${payload.n.length} vs ${payload.c.length}`
    );
  }
  const json = JSON.stringify(payload);
  let base64: string;
  if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(json, "utf8").toString("base64");
  } else {
    // `String.fromCharCode(...bytes)` blows past the JS engine's argument
    // limit on long inputs (~64K bytes on V8, smaller on JSC). Build the
    // binary string a chunk at a time so cursors stay safe even when an
    // orderBy is wide or values are long.
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    base64 = btoa(binary);
  }
  // URL-safe variant, no padding. Strip trailing `=` with a counted slice
  // rather than a regex — `/=+$/` is a quantifier the static analyser flags
  // as polynomial-on-uncontrolled-input even though it's actually linear,
  // and a counted slice is both faster and obviously bounded.
  let trimEnd = base64.length;
  while (trimEnd > 0 && base64.charCodeAt(trimEnd - 1) === 0x3d /* '=' */) {
    trimEnd--;
  }
  const urlSafe = base64
    .slice(0, trimEnd)
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return urlSafe as Cursor;
}

/**
 * Decodes an opaque cursor string into its payload.
 *
 * @throws {StorageValidationError} when the cursor is malformed, exceeds
 *   {@link MAX_CURSOR_LENGTH}, or the format version is unknown. Callers
 *   should surface these as 4xx errors rather than retrying.
 */
export function decodeCursor(cursor: Cursor | string): CursorPayload {
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw new StorageValidationError("Cursor must be a non-empty string");
  }
  if (cursor.length > MAX_CURSOR_LENGTH) {
    // Reject before allocating any of the decode buffers — a hostile client
    // can otherwise force base64-decode + JSON.parse on megabytes of input.
    throw new StorageValidationError(
      `Cursor exceeds maximum length (${cursor.length} > ${MAX_CURSOR_LENGTH})`
    );
  }
  const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  let json: string;
  try {
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(padded + padding, "base64").toString("utf8");
    } else {
      const binary = atob(padded + padding);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      json = new TextDecoder().decode(bytes);
    }
  } catch {
    throw new StorageValidationError("Cursor is not valid base64url");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new StorageValidationError("Cursor payload is not valid JSON");
  }

  const p = parsed as Partial<CursorPayload>;
  if (
    !p ||
    typeof p !== "object" ||
    p.v !== CURSOR_VERSION ||
    !Array.isArray(p.c) ||
    !Array.isArray(p.n) ||
    p.n.length !== p.c.length ||
    !p.n.every((name) => typeof name === "string")
  ) {
    throw new StorageValidationError(`Cursor format is unsupported (expected v${CURSOR_VERSION})`);
  }

  return p as CursorPayload;
}

/**
 * Validates that a decoded cursor matches the effective ordering the
 * current request would use, by exact column-name sequence. A mismatch
 * usually means the caller switched ordering mid-iteration — e.g. asked
 * for `orderBy: [a]` on page 1 and `orderBy: [b]` on page 2, both with
 * arity 1 — which would produce nonsensical results that arity matching
 * alone can't catch.
 */
export function assertCursorMatches(
  payload: CursorPayload,
  effectiveOrderColumns: ReadonlyArray<string>
): void {
  if (payload.n.length !== effectiveOrderColumns.length) {
    throw new StorageValidationError(
      `Cursor has ${payload.n.length} component(s); request expects ${effectiveOrderColumns.length}`
    );
  }
  for (let i = 0; i < effectiveOrderColumns.length; i++) {
    if (payload.n[i] !== effectiveOrderColumns[i]) {
      throw new StorageValidationError(
        `Cursor column ${i} is "${payload.n[i]}"; request expects "${effectiveOrderColumns[i]}"`
      );
    }
  }
}
