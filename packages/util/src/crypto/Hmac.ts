/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { bufToBase64 } from "./WebCrypto";

function bufToBase64Url(buf: Uint8Array): string {
  return bufToBase64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Hash algorithms supported by {@link createHmac}. Names follow the Node
 * `crypto` convention; WebCrypto-style names (e.g. `"SHA-256"`) are also
 * accepted and normalized.
 */
export type HmacHash = "sha1" | "sha256" | "sha384" | "sha512";

/** Output encoding for {@link createHmac}. `"bytes"` returns the raw {@link Uint8Array}. */
export type HmacEncoding = "hex" | "base64" | "base64url" | "bytes";

const HMAC_HASH_NAMES = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
} as const;

function normalizeHash(algorithm: string): (typeof HMAC_HASH_NAMES)[HmacHash] {
  const key = algorithm.toLowerCase().replace(/-/g, "") as HmacHash;
  const name = HMAC_HASH_NAMES[key];
  if (!name) {
    throw new Error(`createHmac: unsupported hash algorithm "${algorithm}"`);
  }
  return name;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Computes an HMAC over `data` using `key` and the given hash `algorithm`.
 *
 * @param algorithm - Hash to use, e.g. `"sha256"`.
 * @param key - Secret key, as a UTF-8 string or raw bytes.
 * @param data - Message to authenticate, as a UTF-8 string or raw bytes.
 * @param encoding - Output format. Defaults to `"hex"`.
 */
export async function createHmac(
  algorithm: HmacHash,
  key: string | Uint8Array,
  data: string | Uint8Array,
  encoding?: "hex" | "base64" | "base64url"
): Promise<string>;
export async function createHmac(
  algorithm: HmacHash,
  key: string | Uint8Array,
  data: string | Uint8Array,
  encoding: "bytes"
): Promise<Uint8Array>;
export async function createHmac(
  algorithm: HmacHash,
  key: string | Uint8Array,
  data: string | Uint8Array,
  encoding: HmacEncoding = "hex"
): Promise<string | Uint8Array> {
  const hash = normalizeHash(algorithm);
  const enc = new TextEncoder();
  const keyBytes = typeof key === "string" ? enc.encode(key) : key;
  const dataBytes = typeof data === "string" ? enc.encode(data) : data;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, dataBytes as unknown as ArrayBuffer);
  const sig = new Uint8Array(sigBuf);

  switch (encoding) {
    case "bytes":
      return sig;
    case "base64":
      return bufToBase64(sig);
    case "base64url":
      return bufToBase64Url(sig);
    case "hex":
      return bytesToHex(sig);
  }
}
