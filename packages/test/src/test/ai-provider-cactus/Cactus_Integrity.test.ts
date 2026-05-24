/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/cactus/ai";
import { describe, expect, it } from "vitest";

const {
  CACTUS_HASH_PLACEHOLDER,
  CactusIntegrityError,
  isHashPlaceholder,
  sha256Hex,
  verifySha256,
} = _testOnly;

// Known SHA-256 of the ASCII string "abc" — RFC 6234 test vector.
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

describe("sha256Hex", () => {
  it('matches the known RFC 6234 vector for "abc"', async () => {
    const hex = await sha256Hex(asciiBytes("abc"));
    expect(hex).toBe(SHA256_ABC);
  });

  it("accepts ArrayBuffer input", async () => {
    // `Uint8Array.prototype.buffer` is typed `ArrayBufferLike` in newer
    // lib.dom.d.ts (it can be SharedArrayBuffer). Materialize a concrete
    // ArrayBuffer so the test exercises that branch of sha256Hex's input.
    const src = asciiBytes("abc");
    const buf = new ArrayBuffer(src.byteLength);
    new Uint8Array(buf).set(src);
    const hex = await sha256Hex(buf);
    expect(hex).toBe(SHA256_ABC);
  });

  it("produces 64 lowercase hex chars", async () => {
    const hex = await sha256Hex(new Uint8Array([0]));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifySha256", () => {
  const ctx = { url: "https://example/asset", filename: "asset.bin" };

  it("passes when the digest matches", async () => {
    await expect(verifySha256(asciiBytes("abc"), SHA256_ABC, ctx)).resolves.toBeUndefined();
  });

  it("accepts uppercase expected hex (normalized to lowercase)", async () => {
    await expect(
      verifySha256(asciiBytes("abc"), SHA256_ABC.toUpperCase(), ctx)
    ).resolves.toBeUndefined();
  });

  it("throws CactusIntegrityError when the digest does not match", async () => {
    const wrong = "0".repeat(64);
    await expect(verifySha256(asciiBytes("abc"), wrong, ctx)).rejects.toBeInstanceOf(
      CactusIntegrityError
    );
  });

  it("throws plain Error when expected hash is too short", async () => {
    await expect(verifySha256(asciiBytes("abc"), "a".repeat(63), ctx)).rejects.toThrow(
      /Invalid catalog SHA-256/
    );
  });

  it("throws plain Error when expected hash is too long", async () => {
    await expect(verifySha256(asciiBytes("abc"), "a".repeat(65), ctx)).rejects.toThrow(
      /Invalid catalog SHA-256/
    );
  });

  it("throws plain Error when expected hash contains non-hex characters", async () => {
    const bad = "z" + "a".repeat(63);
    await expect(verifySha256(asciiBytes("abc"), bad, ctx)).rejects.toThrow(/non-hex characters/);
  });

  it("skips verification when expected is the placeholder sentinel", async () => {
    await expect(
      verifySha256(asciiBytes("garbage"), CACTUS_HASH_PLACEHOLDER, ctx)
    ).resolves.toBeUndefined();
  });
});

describe("isHashPlaceholder", () => {
  it("recognizes the placeholder", () => {
    expect(isHashPlaceholder(CACTUS_HASH_PLACEHOLDER)).toBe(true);
  });

  it("rejects real-looking hashes", () => {
    expect(isHashPlaceholder(SHA256_ABC)).toBe(false);
  });
});

describe("CactusIntegrityError", () => {
  it("carries url, filename, expected, actual on the instance", () => {
    const err = new CactusIntegrityError({
      url: "u",
      filename: "f",
      expected: "e",
      actual: "a",
    });
    expect(err.name).toBe("CactusIntegrityError");
    expect(err.url).toBe("u");
    expect(err.filename).toBe("f");
    expect(err.expected).toBe("e");
    expect(err.actual).toBe("a");
    expect(err.message).toMatch(/Integrity check failed for f/);
  });
});
