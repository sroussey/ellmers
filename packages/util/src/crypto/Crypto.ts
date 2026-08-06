/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { serialize } from "../utilities/Misc";

export async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeFingerprint(input: any): Promise<string> {
  const serializedObj = serialize(input);
  const hash = await sha256(serializedObj);
  return hash;
}

export type uuid4 = `${string}-${string}-${string}-${string}-${string}`;

export function uuid4(): uuid4 {
  return crypto.randomUUID() as uuid4;
}

/**
 * Encode raw bytes as standard base64. Node's `Buffer` fast path when
 * available; otherwise builds the binary string in 32 KiB blocks — one
 * `String.fromCharCode` call per block instead of per byte (a per-byte loop
 * is minutes of main-thread jank on multi-MB payloads, and spreading the
 * whole array in one call overflows the argument stack).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  const BLOCK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += BLOCK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + BLOCK));
  }
  return btoa(bin);
}

/** Decode standard base64 back to bytes. Counterpart of {@link bytesToBase64}. */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
