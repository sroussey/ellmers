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

  const header = dataUri.slice("data:".length, comma);
  const payload = dataUri.slice(comma + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = header.replace(/;base64$/i, "").split(";")[0] || "text/plain";

  try {
    const bytes = isBase64 ? base64ToBytes(payload) : percentDecodeToBytes(payload);
    return new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  } catch {
    return undefined;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
function percentDecodeToBytes(payload: string): Uint8Array {
  const input = new TextEncoder().encode(payload);
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
  // Exact-size copy: the caller hands `.buffer` to Blob, which would otherwise
  // include the slack left by collapsed escape sequences.
  return out.slice(0, length);
}
