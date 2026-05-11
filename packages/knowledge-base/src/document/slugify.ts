/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Convert a heading's visible text into a URL-fragment slug suitable as
 * both an `id` attribute on the rendered heading and a `#…` link target.
 *
 * **The same function MUST be used in both directions** — the chunker
 * stamps section titles onto chunk metadata, the chat layer slugifies
 * the chunk's deepest section title to build a deep link, and the MDX
 * rehype pipeline slugifies heading text when emitting `<h2 id="…">`.
 * If those two slug paths disagree, the deep link won't scroll. Don't
 * reach for `github-slugger` or `rehype-slug`'s default slugger in one
 * spot and this function in another — match exactly.
 *
 * Rules:
 *  - Trim leading/trailing whitespace.
 *  - Any run of characters that aren't ASCII letters, digits, `_`, or
 *    `-` collapses to a single `-`. This covers spaces, punctuation
 *    (`:`, `/`, `?`, `#`, `.`, `,`, `()`, etc.), and Unicode noise.
 *  - Collapse consecutive `-` into one and strip leading/trailing `-`.
 *  - Preserve case so identifier-shaped headings
 *    (e.g. `EncryptedKvCredentialStore`) stay legible in URLs.
 *
 * Returns the empty string if the input has no slug-eligible characters.
 * Callers should treat an empty result as "no anchor available" rather
 * than appending `#` with nothing after it.
 *
 * Dedup of headings whose text slugifies identically (e.g. two `# Why?`
 * sections in one doc) is out of scope: both get the same id, the
 * browser scrolls to the first. Acceptable for v1; if it becomes a
 * problem we can layer a stateful dedup counter on top, but it has to
 * be applied consistently on BOTH ends.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
