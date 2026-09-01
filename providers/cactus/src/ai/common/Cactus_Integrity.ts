/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SHA-256 integrity verification for Cactus model assets.
 *
 * The trust boundary for locally-executed model weights is anchored at the
 * catalog: every byte loaded from disk, Cache Storage, or the network must
 * hash to the catalog-pinned digest. Anything else is treated as adversarial
 * and refused.
 */

/** Sentinel value used in the catalog while real hashes are not yet populated. */
export const CACTUS_HASH_PLACEHOLDER = "TODO_FILL_AT_RELEASE";

/**
 * Raised whenever a Cactus asset fails an integrity check. The `expected`
 * and `actual` fields are deliberately label-agnostic strings so the same
 * error type covers both SHA-256 mismatches ("abc123...") and byte-length
 * mismatches ("22000000 bytes"). The constructor message embeds them
 * verbatim, so callers should phrase each side with whatever unit makes
 * sense at the call site.
 */
export class CactusIntegrityError extends Error {
  readonly url: string;
  readonly filename: string;
  readonly expected: string;
  readonly actual: string;
  constructor(opts: { url: string; filename: string; expected: string; actual: string }) {
    super(
      `Integrity check failed for ${opts.filename} from ${opts.url}: ` +
        `expected ${opts.expected}, got ${opts.actual}`
    );
    this.name = "CactusIntegrityError";
    this.url = opts.url;
    this.filename = opts.filename;
    this.expected = opts.expected;
    this.actual = opts.actual;
  }
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  // Copy into a fresh ArrayBuffer so we hand crypto.subtle.digest a concrete
  // `BufferSource` whose backing buffer is `ArrayBuffer` (not `ArrayBufferLike`).
  // lib.dom types Uint8Array's default generic argument as `ArrayBufferLike`,
  // which digest's parameter type does not accept.
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  const buf = new ArrayBuffer(src.byteLength);
  new Uint8Array(buf).set(src);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

/**
 * Returns `true` if `expected` is the well-known placeholder that means
 * "maintainer has not populated a real hash yet." In that case callers SHOULD
 * skip verification but MUST log a clear warning — this is intended for
 * pre-release dev only and must never reach a tagged release.
 */
export function isHashPlaceholder(expected: string): boolean {
  return expected === CACTUS_HASH_PLACEHOLDER;
}

/**
 * Hashes `bytes` and throws `CactusIntegrityError` if it does not match
 * `expected`. Throws a plain `Error` if `expected` is malformed (not 64 hex
 * chars), since that is a catalog-author bug, not a content bug.
 *
 * When the hashes mismatch, both `expected` and `actual` are lowercase hex
 * SHA-256 strings; the resulting error message reads
 * `expected <hex>, got <hex>`.
 *
 * If `expected` is the `TODO_FILL_AT_RELEASE` placeholder, verification is
 * skipped and a one-time warning is logged. This keeps developers unblocked
 * before the real hashes land while making the gap impossible to miss.
 */
export async function verifySha256(
  bytes: Uint8Array | ArrayBuffer,
  expected: string,
  ctx: { url: string; filename: string }
): Promise<void> {
  if (isHashPlaceholder(expected)) {
    warnPlaceholderOnce(ctx.filename);
    return;
  }
  if (typeof expected !== "string" || expected.length !== 64) {
    throw new Error(
      `Invalid catalog SHA-256 for ${ctx.filename}: must be 64 hex chars (got length ${
        typeof expected === "string" ? expected.length : typeof expected
      })`
    );
  }
  const expectedLc = expected.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedLc)) {
    throw new Error(`Invalid catalog SHA-256 for ${ctx.filename}: contains non-hex characters`);
  }
  const actual = await sha256Hex(bytes);
  if (actual !== expectedLc) {
    throw new CactusIntegrityError({ ...ctx, expected: expectedLc, actual });
  }
}

const _warnedFiles = new Set<string>();
function warnPlaceholderOnce(filename: string): void {
  if (_warnedFiles.has(filename)) return;
  _warnedFiles.add(filename);

  console.warn(
    `[@workglow/cactus] SHA-256 catalog entry for "${filename}" is a placeholder; ` +
      `integrity verification is DISABLED. This must be populated before release.`
  );
}
