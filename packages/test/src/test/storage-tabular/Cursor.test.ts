/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  CURSOR_VERSION,
  MAX_CURSOR_LENGTH,
  decodeCursor,
  encodeCursor,
  StorageValidationError,
} from "@workglow/storage";

describe("Cursor codec", () => {
  it("round-trips a payload through encode → decode", () => {
    const payload = {
      v: 1 as const,
      n: ["id", "createdAt"],
      c: ["abc", "2026-01-02T03:04:05.000Z"],
    };
    const cursor = encodeCursor(payload);
    expect(typeof cursor).toBe("string");
    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual(payload);
  });

  it("produces URL-safe output (no `+`, `/`, or `=` padding)", () => {
    // Pick a payload whose base64 will contain `+`, `/`, and trailing `=`
    // before the URL-safe substitution: many bytes, length not divisible
    // by 3 to force padding.
    const payload = {
      v: 1 as const,
      n: ["c"],
      // Lots of high-bit characters → base64 with `+` and `/`.
      c: ["ÿ".repeat(50)],
    };
    const cursor = encodeCursor(payload);
    expect(cursor).not.toContain("+");
    expect(cursor).not.toContain("/");
    expect(cursor).not.toContain("=");
  });

  it("rejects empty cursors", () => {
    expect(() => decodeCursor("")).toThrow(StorageValidationError);
  });

  it("rejects cursors exceeding MAX_CURSOR_LENGTH before any decode work", () => {
    // Build a cursor longer than the cap. The decode side must reject it
    // up front — without this guard a hostile client could force a multi-
    // megabyte base64-decode + JSON.parse.
    const oversize = "a".repeat(MAX_CURSOR_LENGTH + 1);
    expect(() => decodeCursor(oversize)).toThrow(StorageValidationError);
    expect(() => decodeCursor(oversize)).toThrow(/exceeds maximum length/i);
  });

  it("accepts cursors at exactly MAX_CURSOR_LENGTH (no off-by-one)", () => {
    // Construct a valid cursor at exactly the cap. We don't need it to
    // round-trip a specific payload — just to not be rejected by the
    // length check. We append junk *after* a real cursor so the JSON
    // parse will fail (proving we got past the length gate); a real
    // cap-length cursor would be a giant payload.
    const realCursor = encodeCursor({ v: 1, n: ["id"], c: ["x"] });
    if (realCursor.length >= MAX_CURSOR_LENGTH) return; // sanity; should be tiny
    const padded = realCursor + "a".repeat(MAX_CURSOR_LENGTH - realCursor.length);
    // Length is exactly at the cap — it shouldn't trip the size guard.
    // It will likely fail JSON parsing further down, which is also a
    // StorageValidationError but with a different message.
    expect(padded.length).toBe(MAX_CURSOR_LENGTH);
    let err: Error | undefined;
    try {
      decodeCursor(padded);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(StorageValidationError);
    expect(err?.message).not.toMatch(/exceeds maximum length/i);
  });

  it("rejects malformed base64", () => {
    // `~` isn't a valid base64url character.
    expect(() => decodeCursor("~~~~not-base64~~~~")).toThrow(StorageValidationError);
  });

  it("rejects payloads whose JSON parses but is the wrong shape", () => {
    // Valid base64url + JSON, but missing `n` / `c`.
    const garbage = encodeCursor({ v: 1, n: [], c: [] });
    expect(() => decodeCursor(garbage)).not.toThrow();
    // But a payload without `c` is rejected.
    const bad = Buffer.from(JSON.stringify({ v: 1, n: ["id"] }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => decodeCursor(bad)).toThrow(StorageValidationError);
  });

  it("rejects payloads with an unknown format version", () => {
    const future = Buffer.from(JSON.stringify({ v: 99, n: [], c: [] }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => decodeCursor(future)).toThrow(StorageValidationError);
    expect(() => decodeCursor(future)).toThrow(
      new RegExp(`expected v${CURSOR_VERSION}`)
    );
  });

  it("rejects payloads whose n and c arrays disagree in length", () => {
    // Encode a mismatched payload by hand (encodeCursor no longer guards).
    const bad = Buffer.from(
      JSON.stringify({ v: 1, n: ["a", "b"], c: ["only-one"] }),
      "utf8"
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => decodeCursor(bad)).toThrow(StorageValidationError);
  });

  it("preserves null values in the payload", () => {
    const cursor = encodeCursor({ v: 1, n: ["x", "y"], c: [null, "z"] });
    expect(decodeCursor(cursor)).toEqual({ v: 1, n: ["x", "y"], c: [null, "z"] });
  });
});
