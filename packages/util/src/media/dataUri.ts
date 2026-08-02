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
    const bytes = isBase64
      ? base64ToBytes(payload)
      : new TextEncoder().encode(decodeURIComponent(payload));
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
