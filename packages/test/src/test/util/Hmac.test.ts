/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHmac } from "@workglow/util";
import { describe, expect, it } from "vitest";

describe("createHmac", () => {
  // RFC 4231 Test Case 2.
  const key = "Jefe";
  const data = "what do ya want for nothing?";
  const expectedSha256 = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

  it("computes HMAC-SHA256 as a hex string by default", async () => {
    expect(await createHmac("sha256", key, data)).toBe(expectedSha256);
  });

  it("matches RFC 4231 SHA-512", async () => {
    expect(await createHmac("sha512", key, data)).toBe(
      "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737"
    );
  });

  it("supports base64 encoding", async () => {
    const expected = Buffer.from(expectedSha256, "hex").toString("base64");
    expect(await createHmac("sha256", key, data, "base64")).toBe(expected);
  });

  it("supports base64url encoding", async () => {
    const expected = Buffer.from(expectedSha256, "hex").toString("base64url");
    expect(await createHmac("sha256", key, data, "base64url")).toBe(expected);
  });

  it("supports raw byte output", async () => {
    const bytes = await createHmac("sha256", key, data, "bytes");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes).toString("hex")).toBe(expectedSha256);
  });

  it("accepts Uint8Array key and data", async () => {
    const enc = new TextEncoder();
    expect(await createHmac("sha256", enc.encode(key), enc.encode(data))).toBe(expectedSha256);
  });

  it("throws on an unsupported algorithm", async () => {
    // @ts-expect-error — intentional test of unsupported algorithm
    await expect(createHmac("md5", key, data)).rejects.toThrow(/unsupported hash algorithm/);
  });
});
