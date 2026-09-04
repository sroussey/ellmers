/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SearchResult } from "./IWebSearchProvider";

/**
 * Trims a provider's results to the caller's `maxResults`.
 *
 * `maxResults` is an upper bound on what comes back, and it has to mean that
 * for every provider — a number the caller sizes a downstream prompt against is
 * useless if one provider treats it as a search budget and another discards it.
 *
 * A provider whose API takes its own result limit still sends it; this is the
 * backstop for the ones that take none, and the single place the meaning lives.
 */
export function limitResults(
  results: readonly SearchResult[],
  maxResults: number | undefined
): SearchResult[] {
  return maxResults === undefined ? [...results] : results.slice(0, maxResults);
}
