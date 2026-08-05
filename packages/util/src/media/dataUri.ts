/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Decode a `data:` URI to a `Blob` in-process.
 *
 * Deliberately does not use `fetch(dataUri)`: a strict `connect-src` CSP (the
 * builder app and the Electron shell both ship one) blocks `data:` as a fetch
 * destination, so the request fails with `TypeError: Failed to fetch` before
 * any decoding happens. Decoding locally is also cheaper — no request
 * machinery for bytes already in memory.
 *
 * Returns `undefined` when the URI is malformed or its payload cannot be
 * decoded; callers decide whether that is an error.
 */
export function dataUriToBlob(dataUri: string): Blob | undefined {
  if (!dataUri.startsWith("data:")) return undefined;
  const comma = dataUri.indexOf(",");
  if (comma < 0) return undefined;

  // The data-URL processor strips whitespace around the media type and allows
  // spaces between the `;` and `base64`, so `data:image/png; base64,…` is a
  // base64 URI. Missing that spelling decodes the base64 *text* as the payload.
  const header = dataUri.slice("data:".length, comma).trim();
  const payload = dataUri.slice(comma + 1);
  const isBase64 = BASE64_SUFFIX.test(header);
  const mime = (header.replace(BASE64_SUFFIX, "").split(";")[0] ?? "").trim() || "text/plain";

  try {
    // The body is percent-decoded first and base64-decoded second, so a base64
    // payload that was itself percent-encoded (`%2B` for `+`, `%3D` for `=` —
    // what happens when a data URI round-trips through `encodeURIComponent` or
    // a URL query) decodes exactly as `fetch()` decodes it. Only pay for the
    // extra pass when there is an escape to decode.
    const decoded = payload.includes("%") ? percentDecodeToBytes(payload) : undefined;
    const bytes = isBase64
      ? base64ToBytes(decoded === undefined ? payload : isomorphicDecode(decoded))
      : (decoded ?? TEXT_ENCODER.encode(payload));
    return new Blob([bytes], { type: mime });
  } catch {
    return undefined;
  }
}

/** `;` + zero or more spaces + `base64`, anchored to the end of the header. */
const BASE64_SUFFIX = /; *base64$/i;

const TEXT_ENCODER = new TextEncoder();

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Bytes → the string of the same code points, which is what `atob` consumes. */
function isomorphicDecode(bytes: Uint8Array): string {
  // Chunked: spreading a multi-megabyte payload into one call overflows the stack.
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** ASCII hex digit → value, or -1. */
function hexValue(byte: number | undefined): number {
  if (byte === undefined) return -1;
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30; // 0-9
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x37; // A-F
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x57; // a-f
  return -1;
}

/**
 * Percent-decodes the payload to raw bytes, byte-by-byte.
 *
 * Deliberately not `decodeURIComponent`: that decodes to a *string*, so it
 * UTF-8-validates the escaped bytes and throws `URIError` on any sequence that
 * is not valid UTF-8. Non-base64 data URIs are allowed to carry arbitrary
 * binary — `data:image/png,%89PNG%0D%0A...` is legal and `fetch()` decodes it
 * fine — so validating as text would reject well-formed input.
 *
 * A `%` not followed by two hex digits is emitted literally, matching the
 * WHATWG percent-decode (and therefore `fetch()`) rather than throwing.
 * Unescaped characters are UTF-8 encoded, as the data-URL processor specifies.
 */
function percentDecodeToBytes(payload: string): Uint8Array<ArrayBuffer> {
  const input = TEXT_ENCODER.encode(payload);
  const out = new Uint8Array(input.length);
  let length = 0;
  for (let i = 0; i < input.length; i++) {
    const byte = input[i]!;
    if (byte !== 0x25 /* % */) {
      out[length++] = byte;
      continue;
    }
    const high = hexValue(input[i + 1]);
    const low = hexValue(input[i + 2]);
    if (high < 0 || low < 0) {
      out[length++] = byte;
      continue;
    }
    out[length++] = (high << 4) | low;
    i += 2;
  }
  // A view, not a copy: `Blob` copies what it is handed, so the slack left by
  // collapsed escape sequences is dropped without a second pass over the bytes.
  return out.subarray(0, length);
}
