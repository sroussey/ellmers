/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

const SLASH = 0x2f;

/**
 * Removes trailing `/` characters.
 *
 * Deliberately not `replace(/\/+$/, "")`. That pattern is quadratic on a string
 * holding a long run of slashes that is NOT at the end: the engine starts `\/+`
 * at every slash position, consumes the whole run, then fails `$` and restarts
 * one character along. Both call sites take caller-supplied text — a search
 * domain and a configured base URL — so the input is untrusted. A single
 * reverse scan is linear and allocates one string.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SLASH) end--;
  return end === value.length ? value : value.slice(0, end);
}
